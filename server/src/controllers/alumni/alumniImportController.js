import crypto from 'node:crypto';
import AlumniImportBatch from '../../models/AlumniImportBatch.js';
import AlumniInvite from '../../models/AlumniInvite.js';
import AlumniProfile from '../../models/AlumniProfile.js';
import Chapter from '../../models/Chapter.js';
import ChapterMember from '../../models/ChapterMember.js';
import User from '../../models/User.js';
import Session from '../../models/Session.js';
import { ApiError, asyncHandler, pageMeta, paginate, escapeRegex } from '../../utils/http.js';
import { logActivity } from '../../utils/activity.js';
import { sendMail, mailEnabled } from '../../utils/mailer.js';
import { hashToken, newJti, refreshExpiry, signAccessToken, signRefreshToken, setRefreshCookie, isMobileClient } from '../../utils/tokens.js';
import { parseDevice } from '../authController.js';
import { env } from '../../config/env.js';
import { DEPARTMENTS } from '../../constants.js';

const PUBLIC_USER_FIELDS = 'name email role department year avatar phone designation employeeId rollNo';

function parseCsv(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let insideQuotes = false;
    let field = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (c === ',' && !insideQuotes) {
        row.push(field.trim());
        field = '';
      } else {
        field += c;
      }
    }
    row.push(field.trim());
    result.push(row);
  }
  return result;
}

// ── POST /api/alumni/import/preview ────────────────────────────────
export const previewImport = asyncHandler(async (req, res) => {
  if (!req.file && !req.body.csv) {
    throw new ApiError(400, 'Please upload a CSV file or provide csv content');
  }

  const rawCsv = req.file ? req.file.buffer.toString('utf-8') : req.body.csv;
  const parsed = parseCsv(rawCsv);

  if (parsed.length < 2) {
    throw new ApiError(422, 'CSV file must have a header row and at least one data row');
  }

  const user = req.user;
  const isHod = user.role === 'hod';
  const hodDept = user.department;

  // Header normalization
  const headers = parsed[0].map((h) => h.toLowerCase().trim());
  const colIndex = {
    name: headers.indexOf('name'),
    email: headers.indexOf('email'),
    department: headers.indexOf('department'),
    gradYear: headers.findIndex((h) => h === 'gradyear' || h === 'grad_year' || h === 'graduation_year'),
    company: headers.indexOf('company'),
    designation: headers.indexOf('designation'),
    location: headers.indexOf('location'),
    phone: headers.indexOf('phone'),
  };

  if (colIndex.name === -1 || colIndex.email === -1 || colIndex.department === -1 || colIndex.gradYear === -1) {
    throw new ApiError(422, 'CSV missing required columns: name, email, department, gradYear');
  }

  const dataRows = parsed.slice(1);
  if (dataRows.length > env.alumni.importMaxRows) {
    throw new ApiError(422, `Maximum rows exceeded (${env.alumni.importMaxRows} max)`);
  }

  // Pre-fetch existing emails from DB
  const emailsInFile = dataRows.map((r) => String(r[colIndex.email] || '').trim().toLowerCase()).filter(Boolean);
  const existingUsers = await User.find({ email: { $in: emailsInFile } }).distinct('email');
  const existingSet = new Set(existingUsers.map((e) => e.toLowerCase()));

  const seenInFile = new Set();
  const rows = [];
  const totals = { rows: dataRows.length, valid: 0, invalid: 0, duplicates: 0, alreadyExist: 0 };

  dataRows.forEach((r, idx) => {
    const line = idx + 2;
    const name = String(r[colIndex.name] || '').trim();
    const email = String(r[colIndex.email] || '').trim().toLowerCase();
    const department = String(r[colIndex.department] || '').trim();
    const gradYear = Number(r[colIndex.gradYear]);
    const company = colIndex.company !== -1 ? String(r[colIndex.company] || '').trim() : '';
    const designation = colIndex.designation !== -1 ? String(r[colIndex.designation] || '').trim() : '';
    const location = colIndex.location !== -1 ? String(r[colIndex.location] || '').trim() : '';
    const phone = colIndex.phone !== -1 ? String(r[colIndex.phone] || '').trim() : '';

    const errors = [];

    if (!name) errors.push('Name is required');
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) errors.push('Valid email is required');
    if (!department) errors.push('Department is required');
    else if (!DEPARTMENTS.includes(department)) errors.push(`Unknown department "${department}"`);

    if (isHod && department && department !== hodDept) {
      errors.push(`HOD can only import alumni for their own department (${hodDept})`);
    }

    if (!gradYear || gradYear < 1980 || gradYear > 2100) {
      errors.push('Graduation year must be between 1980 and 2100');
    }

    let state = 'valid';
    if (errors.length > 0) {
      state = 'invalid';
      totals.invalid++;
    } else if (seenInFile.has(email)) {
      state = 'duplicate';
      errors.push('Duplicate email in this file');
      totals.duplicates++;
    } else if (existingSet.has(email)) {
      state = 'exists';
      errors.push('A user account with this email already exists');
      totals.alreadyExist++;
    } else {
      seenInFile.add(email);
      totals.valid++;
    }

    rows.push({
      line,
      name,
      email,
      department,
      gradYear: isNaN(gradYear) ? undefined : gradYear,
      company,
      designation,
      location,
      phone,
      state,
      errors,
    });
  });

  const batch = await AlumniImportBatch.create({
    uploadedBy: user._id,
    filename: req.file?.originalname || 'import.csv',
    department: isHod ? hodDept : undefined,
    totals,
    rows,
    status: 'validated',
  });

  res.status(201).json(batch);
});

// ── POST /api/alumni/import/:batchId/commit ────────────────────────
export const commitImport = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  const { sendEmails = true } = req.body;
  const user = req.user;

  const batch = await AlumniImportBatch.findById(batchId);
  if (!batch) throw new ApiError(404, 'Import batch not found');

  if (batch.status === 'done') {
    throw new ApiError(409, 'This import batch has already been committed');
  }

  const validRows = batch.rows.filter((r) => r.state === 'valid');
  if (!validRows.length) {
    throw new ApiError(400, 'Batch has no valid rows to commit');
  }

  const expiresDays = env.alumni.inviteExpiresDays || 14;
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);

  const invitesToCreate = [];
  const links = [];

  for (const row of validRows) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);

    invitesToCreate.push({
      email: row.email,
      name: row.name,
      department: row.department,
      gradYear: row.gradYear,
      company: row.company,
      designation: row.designation,
      location: row.location,
      phone: row.phone,
      tokenHash,
      expiresAt,
      status: 'pending',
      batch: batch._id,
      invitedBy: user._id,
    });

    const claimUrl = `${env.appUrl}/alumni/claim?token=${rawToken}`;
    links.push({
      name: row.name,
      email: row.email,
      claimUrl,
    });
  }

  const createdInvites = await AlumniInvite.insertMany(invitesToCreate);
  let emailsSent = 0;

  if (sendEmails && mailEnabled()) {
    for (const item of links) {
      const sent = await sendMail({
        to: item.email,
        subject: 'Invitation to Join CampusConnect Alumni Network',
        html: `
          <p>Hello ${item.name},</p>
          <p>You have been invited to join the official alumni network of J.N.N Institute of Engineering.</p>
          <p><a href="${item.claimUrl}" style="display:inline-block;padding:10px 20px;background:#6c5dd3;color:white;text-decoration:none;border-radius:8px;font-weight:bold;">Claim Your Alumni Account</a></p>
          <p>Or copy this link into your browser:<br/>${item.claimUrl}</p>
          <p>This invitation expires in ${expiresDays} days.</p>
        `,
      });
      if (sent) emailsSent++;
    }
  }

  batch.status = 'done';
  batch.committedAt = new Date();
  batch.invitesCreated = createdInvites.length;
  batch.emailsSent = emailsSent;
  await batch.save();

  logActivity(req, 'alumni.import_committed', {
    entityType: 'import_batch',
    entityId: batch._id,
    summary: `${createdInvites.length} invites created, ${emailsSent} emails sent`,
  });

  // Generate downloadable links CSV if emails were not sent
  const linksCsv = links.map((l) => `"${l.name}","${l.email}","${l.claimUrl}"`).join('\n');

  res.json({
    ok: true,
    invitesCreated: createdInvites.length,
    emailsSent,
    downloadLinksCsv: `Name,Email,ClaimUrl\n${linksCsv}`,
  });
});

// ── GET /api/alumni/import ─────────────────────────────────────────
export const listImports = asyncHandler(async (req, res) => {
  const user = req.user;
  const filter = {};
  if (user.role === 'hod') {
    filter.department = user.department;
  }

  const batches = await AlumniImportBatch.find(filter)
    .populate('uploadedBy', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  res.json(batches);
});

// ── GET /api/alumni/import/:id ─────────────────────────────────────
export const getImportBatch = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const batch = await AlumniImportBatch.findById(id).populate('uploadedBy', 'name email');
  if (!batch) throw new ApiError(404, 'Import batch not found');

  if (req.user.role === 'hod' && batch.department && batch.department !== req.user.department) {
    throw new ApiError(403, 'Permission denied');
  }

  res.json(batch);
});

// ── GET /api/alumni/invites ────────────────────────────────────────
export const listInvites = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 20, 100);
  const { status, search } = req.query;
  const user = req.user;

  const filter = {};
  if (status) filter.status = status;
  if (user.role === 'hod') filter.department = user.department;

  if (search && search.trim()) {
    const q = escapeRegex(search.trim());
    filter.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }, { company: new RegExp(q, 'i') }];
  }

  const [items, total] = await Promise.all([
    AlumniInvite.find(filter)
      .populate('invitedBy', 'name')
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AlumniInvite.countDocuments(filter),
  ]);

  res.json({
    items,
    ...pageMeta(total, page, limit),
  });
});

// ── POST /api/alumni/invites/:id/resend ─────────────────────────────
export const resendInvite = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const invite = await AlumniInvite.findById(id);
  if (!invite || invite.status !== 'pending') {
    throw new ApiError(404, 'Pending invite not found');
  }

  if (req.user.role === 'hod' && invite.department !== req.user.department) {
    throw new ApiError(403, 'Permission denied');
  }

  if (invite.sendCount >= 5) {
    throw new ApiError(429, 'Maximum resend limit reached for this invitation (max 5)');
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresDays = env.alumni.inviteExpiresDays || 14;

  invite.tokenHash = hashToken(rawToken);
  invite.expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
  invite.lastSentAt = new Date();
  invite.sendCount = (invite.sendCount || 1) + 1;
  await invite.save();

  const claimUrl = `${env.appUrl}/alumni/claim?token=${rawToken}`;

  if (mailEnabled()) {
    await sendMail({
      to: invite.email,
      subject: 'Invitation to Join CampusConnect Alumni Network (Reminder)',
      html: `
        <p>Hello ${invite.name},</p>
        <p>Here is your renewed invitation to join the official alumni network of J.N.N Institute of Engineering.</p>
        <p><a href="${claimUrl}" style="display:inline-block;padding:10px 20px;background:#6c5dd3;color:white;text-decoration:none;border-radius:8px;font-weight:bold;">Claim Your Alumni Account</a></p>
        <p>This invitation expires in ${expiresDays} days.</p>
      `,
    });
  }

  res.json({ ok: true, claimUrl, message: 'Invite resent successfully' });
});

// ── PATCH /api/alumni/invites/:id/revoke ────────────────────────────
export const revokeInvite = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const invite = await AlumniInvite.findById(id);
  if (!invite) throw new ApiError(404, 'Invite not found');

  if (req.user.role === 'hod' && invite.department !== req.user.department) {
    throw new ApiError(403, 'Permission denied');
  }

  invite.status = 'revoked';
  await invite.save();
  res.json({ ok: true, message: 'Invite revoked' });
});

// ── Public Claim Endpoints ─────────────────────────────────────────

// ── GET /api/auth/alumni-claim/:token ──────────────────────────────
export const getPublicClaim = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const tokenHash = hashToken(token);

  const invite = await AlumniInvite.findOne({
    tokenHash,
    status: 'pending',
    expiresAt: { $gte: new Date() },
  });

  if (!invite) throw new ApiError(404, 'Invalid or expired invitation link');

  res.json({
    name: invite.name,
    email: invite.email,
    department: invite.department,
    gradYear: invite.gradYear,
    company: invite.company,
    designation: invite.designation,
    location: invite.location,
    phone: invite.phone,
  });
});

// ── POST /api/auth/alumni-claim/:token ─────────────────────────────
export const submitPublicClaim = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new ApiError(422, 'Password must be at least 8 characters and contain both letters and digits');
  }

  const tokenHash = hashToken(token);
  const invite = await AlumniInvite.findOne({
    tokenHash,
    status: 'pending',
    expiresAt: { $gte: new Date() },
  });

  if (!invite) throw new ApiError(404, 'Invalid or expired invitation link');

  // Check if user already registered in the meantime
  let existingUser = await User.findOne({ email: invite.email });
  if (existingUser) {
    invite.status = 'claimed';
    invite.user = existingUser._id;
    await invite.save();
    throw new ApiError(409, 'An account with this email already exists. Please log in.');
  }

  // Create User
  const newUser = await User.create({
    name: invite.name,
    email: invite.email,
    password,
    role: 'alumni',
    department: invite.department,
    phone: invite.phone,
    isActive: true,
  });

  // Create Profile
  const profile = await AlumniProfile.create({
    user: newUser._id,
    gradYear: invite.gradYear,
    company: invite.company,
    designation: invite.designation,
    location: invite.location,
    source: 'import',
    isVerified: env.alumni.autoVerifyImported,
    showInDirectory: true,
  });

  invite.status = 'claimed';
  invite.user = newUser._id;
  invite.claimedAt = new Date();
  await invite.save();

  // Auto-join batch and dept chapters if enabled and profile is verified
  if (profile.isVerified && env.alumni.chapterAutojoin) {
    const matchingChapters = await Chapter.find({
      $or: [
        { type: 'batch', gradYear: profile.gradYear },
        { type: 'department', department: newUser.department },
      ],
      archived: false,
    });
    for (const ch of matchingChapters) {
      await ChapterMember.updateOne(
        { chapter: ch._id, user: newUser._id },
        { $setOnInsert: { role: 'member', status: 'active' } },
        { upsert: true }
      );
      await Chapter.updateOne({ _id: ch._id }, { $inc: { memberCount: 1 } });
    }
  }

  // Issue Login Session
  const jti = newJti();
  const session = await Session.create({
    user: newUser._id,
    jti,
    expiresAt: refreshExpiry(),
    client: isMobileClient(req) ? 'mobile' : 'web',
    device: parseDevice(req.headers['user-agent'], req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    ip: req.ip,
  });

  const refreshToken = signRefreshToken(newUser, session._id, jti);
  const accessToken = signAccessToken(newUser, session._id);

  if (isMobileClient(req)) {
    res.json({ accessToken, refreshToken, user: newUser });
  } else {
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, user: newUser });
  }
});
