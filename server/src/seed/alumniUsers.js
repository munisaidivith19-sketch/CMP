/**
 * Idempotent demo alumni logins (development only). Unlike seedAlumniNetwork() this
 * NEVER deletes anything: it only upserts these 5 accounts and their demo data.
 *
 *   npm run seed:alumni --prefix server      (password for every account: Password@123)
 */
import { fileURLToPath } from 'node:url';
import User from '../models/User.js';
import AlumniProfile from '../models/AlumniProfile.js';
import MentorshipRequest from '../models/MentorshipRequest.js';
import MentorshipSlot from '../models/MentorshipSlot.js';
import AlumniJob from '../models/AlumniJob.js';
import JobApplication from '../models/JobApplication.js';

const PASSWORD = 'Password@123';
const DAY = 86400000;

const ALUMNI = [
  {
    email: 'karthik.alumni@campus.edu', name: 'Karthik Ramachandran', department: 'CSE', gradYear: 2018,
    company: 'Google', designation: 'Senior Software Engineer', location: 'Bengaluru',
    domains: ['software_engineering', 'higher_studies'], skills: ['Go', 'Distributed Systems', 'System Design'],
    headline: 'Building large-scale systems', about: 'Happy to mentor on backend engineering and interviews.', linkedin: 'https://linkedin.com/in/karthik-demo',
    mentorshipAvailable: true, maxActiveMentees: 3, mentees: 1, isVerified: true, openToReferrals: true, slots: 2,
  },
  {
    email: 'pooja.alumni@campus.edu', name: 'Pooja Sundaram', department: 'ECE', gradYear: 2017,
    company: 'Qualcomm', designation: 'Staff Engineer', location: 'Hyderabad',
    domains: ['core_engineering'], skills: ['Embedded C', 'VLSI', 'DSP'],
    headline: 'Silicon and embedded', about: 'Mentoring is currently at full capacity.', linkedin: 'https://linkedin.com/in/pooja-demo',
    mentorshipAvailable: true, maxActiveMentees: 3, mentees: 3, isVerified: true, openToReferrals: false, slots: 0,
  },
  {
    email: 'aravind.alumni@campus.edu', name: 'Aravind Swaminathan', department: 'CSE', gradYear: 2016,
    company: 'Zoho', designation: 'Engineering Manager', location: 'Chennai',
    domains: ['software_engineering', 'entrepreneurship'], skills: ['Java', 'Hiring', 'Product'],
    headline: 'Hiring from campus', about: 'I post openings and give referrals.', linkedin: 'https://linkedin.com/in/aravind-demo',
    mentorshipAvailable: true, maxActiveMentees: 2, mentees: 0, isVerified: true, openToReferrals: true, slots: 0, job: true,
  },
  {
    email: 'divya.alumni@campus.edu', name: 'Divya Balasubramanian', department: 'IT', gradYear: 2023,
    company: '', designation: '', location: '',
    domains: [], skills: [],
    mentorshipAvailable: false, maxActiveMentees: 2, mentees: 0, isVerified: false, openToReferrals: false, slots: 0,
  },
  {
    email: 'rohan.alumni@campus.edu', name: 'Rohan Varma', department: 'MECH', gradYear: 2019,
    company: 'Tata Motors', designation: 'Design Engineer', location: 'Pune',
    domains: ['core_engineering'], skills: ['CAD', 'FEA'],
    headline: 'Automotive design', about: 'Prefers to keep contact details private.', linkedin: 'https://linkedin.com/in/rohan-demo',
    mentorshipAvailable: true, maxActiveMentees: 3, mentees: 0, isVerified: true, openToReferrals: false, slots: 0,
    privacy: { email: 'hidden', phone: 'hidden', company: 'public', designation: 'public', location: 'public', linkedin: 'public' },
  },
];

async function upsertUser(data) {
  let user = await User.findOne({ email: data.email });
  if (!user) {
    user = new User({ email: data.email, password: PASSWORD, role: 'alumni' });
  }
  user.name = data.name;
  user.role = 'alumni';
  user.department = data.department;
  user.designation = data.designation || undefined;
  user.isActive = true;
  await user.save();
  return user;
}

async function ensureMentees(n) {
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    const email = `demo.mentee${i}@campus.edu`;
    let u = await User.findOne({ email });
    if (!u) {
      u = await User.create({
        name: `Demo Mentee ${i}`, email, password: PASSWORD, role: 'student',
        department: 'CSE', year: 3, semester: 5, section: 'A', rollNo: `DM${i}`,
      });
    }
    out.push(u);
  }
  return out;
}

export async function seedAlumniUsers() {
  const mentees = await ensureMentees(3);
  const created = [];

  for (const a of ALUMNI) {
    const user = await upsertUser(a);

    const profile = await AlumniProfile.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          gradYear: a.gradYear, company: a.company || undefined, designation: a.designation || undefined,
          location: a.location || undefined, linkedin: a.linkedin, headline: a.headline, about: a.about,
          domains: a.domains, skills: a.skills, mentorshipAvailable: a.mentorshipAvailable,
          maxActiveMentees: a.maxActiveMentees, activeMenteeCount: a.mentees, openToReferrals: a.openToReferrals,
          isVerified: a.isVerified, showInDirectory: true, source: 'admin',
          ...(a.privacy ? { privacy: a.privacy } : {}),
          ...(a.isVerified ? { verifiedAt: new Date() } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Accepted mentees so the reconcile job agrees with activeMenteeCount.
    for (let i = 0; i < a.mentees; i += 1) {
      const exists = await MentorshipRequest.exists({ student: mentees[i]._id, alumni: user._id, status: 'accepted' });
      if (!exists) {
        await MentorshipRequest.create({
          student: mentees[i]._id, alumni: user._id, domain: a.domains[0] || 'other',
          message: 'Looking forward to your guidance.', status: 'accepted', respondedAt: new Date(),
        });
      }
    }

    // Open slots for the "available mentor".
    if (a.slots) {
      const open = await MentorshipSlot.countDocuments({ alumni: user._id, status: 'open', startsAt: { $gt: new Date() } });
      for (let i = open; i < a.slots; i += 1) {
        const startsAt = new Date(Date.now() + (i + 2) * DAY);
        startsAt.setHours(18, 0, 0, 0);
        await MentorshipSlot.create({ alumni: user._id, startsAt, durationMin: 30, mode: 'video', meetingLink: 'https://meet.google.com/demo-slot' });
      }
    }

    // A job + applicants for the "job poster".
    if (a.job) {
      let job = await AlumniJob.findOne({ postedBy: user._id, title: 'Backend Engineer (Campus Hiring)' });
      if (!job) {
        job = await AlumniJob.create({
          postedBy: user._id, title: 'Backend Engineer (Campus Hiring)', company: a.company, type: 'full_time',
          workMode: 'hybrid', location: a.location, applyMode: 'referral', status: 'open',
          description: 'Join our platform team. Strong data structures, Node or Java, and curiosity required.',
          skills: ['Java', 'Node.js'], deadline: new Date(Date.now() + 30 * DAY),
        });
      }
      for (const m of mentees.slice(0, 2)) {
        const has = await JobApplication.exists({ job: job._id, student: m._id });
        if (!has) {
          await JobApplication.create({ job: job._id, student: m._id, poster: user._id, note: 'Keen to apply.', referralRequested: true, status: 'applied' });
          await AlumniJob.updateOne({ _id: job._id }, { $inc: { applicationCount: 1 } });
        }
      }
    }

    created.push({ email: a.email, verified: profile.isVerified });
  }
  return created;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { connectDB } = await import('../config/db.js');
  const { default: mongoose } = await import('mongoose');
  await connectDB();
  const rows = await seedAlumniUsers();
  console.log(`\n✅ Alumni demo accounts ready (password: ${PASSWORD})`);
  console.table(rows);
  await mongoose.disconnect();
}
