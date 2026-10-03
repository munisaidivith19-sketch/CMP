import crypto from 'node:crypto';
import User from '../models/User.js';
import AlumniProfile from '../models/AlumniProfile.js';
import MentorshipRequest from '../models/MentorshipRequest.js';
import MentorshipSlot from '../models/MentorshipSlot.js';
import MentorshipSession from '../models/MentorshipSession.js';
import AlumniJob from '../models/AlumniJob.js';
import JobApplication from '../models/JobApplication.js';
import AlumniEvent from '../models/AlumniEvent.js';
import AlumniEventRsvp from '../models/AlumniEventRsvp.js';
import Chapter from '../models/Chapter.js';
import ChapterMember from '../models/ChapterMember.js';
import ChapterPost from '../models/ChapterPost.js';
import ChapterComment from '../models/ChapterComment.js';
import AlumniImportBatch from '../models/AlumniImportBatch.js';
import AlumniInvite from '../models/AlumniInvite.js';

const PASSWORD = 'Password@123';
const DAY = 86400000;
const daysFromNow = (n, hour = 14) => {
  const d = new Date(Date.now() + n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

export async function seedAlumniNetwork() {
  console.log('[alumni-seed] Seeding Alumni Network data…');

  // Clear existing alumni tables
  await Promise.all([
    AlumniProfile.deleteMany({}),
    MentorshipRequest.deleteMany({}),
    MentorshipSlot.deleteMany({}),
    MentorshipSession.deleteMany({}),
    AlumniJob.deleteMany({}),
    JobApplication.deleteMany({}),
    AlumniEvent.deleteMany({}),
    AlumniEventRsvp.deleteMany({}),
    Chapter.deleteMany({}),
    ChapterMember.deleteMany({}),
    ChapterPost.deleteMany({}),
    ChapterComment.deleteMany({}),
    AlumniImportBatch.deleteMany({}),
    AlumniInvite.deleteMany({}),
  ]);

  // Find a student and admin to link relationships
  const student = await User.findOne({ role: 'student' });
  const admin = await User.findOne({ role: 'admin' });
  const hodCSE = await User.findOne({ role: 'hod', department: { $regex: /CSE/i } }) || admin;

  // 1. Create Alumni Users
  const alumniData = [
    {
      name: 'Karthik Ramachandran',
      email: 'karthik.alumni@campus.edu',
      department: 'CSE',
      gradYear: 2021,
      company: 'Google India',
      designation: 'Staff Software Engineer',
      location: 'Bengaluru',
      skills: ['Distributed Systems', 'Go', 'Kubernetes', 'System Design'],
      domains: ['software_engineering', 'core_engineering'],
      mentorshipAvailable: true,
      maxActiveMentees: 3,
      activeMenteeCount: 1,
      ratingAvg: 4.9,
      ratingCount: 14,
      isVerified: true,
      openToReferrals: true,
    },
    {
      name: 'Pooja Sundaram',
      email: 'pooja.alumni@campus.edu',
      department: 'ECE',
      gradYear: 2020,
      company: 'Qualcomm',
      designation: 'Senior Hardware Engineer',
      location: 'Hyderabad',
      skills: ['Verilog', 'VLSI', 'FPGA', 'ASIC Design'],
      domains: ['core_engineering'],
      mentorshipAvailable: true,
      maxActiveMentees: 2,
      activeMenteeCount: 0,
      ratingAvg: 4.8,
      ratingCount: 9,
      isVerified: true,
      openToReferrals: true,
    },
    {
      name: 'Aravind Swaminathan',
      email: 'aravind.alumni@campus.edu',
      department: 'AI & DS',
      gradYear: 2022,
      company: 'Microsoft',
      designation: 'Data Scientist',
      location: 'Bengaluru',
      skills: ['Machine Learning', 'PyTorch', 'LLMs', 'Azure'],
      domains: ['data_science', 'software_engineering'],
      mentorshipAvailable: true,
      maxActiveMentees: 2,
      activeMenteeCount: 1,
      ratingAvg: 5.0,
      ratingCount: 6,
      isVerified: true,
      openToReferrals: true,
    },
    {
      name: 'Divya Balasubramanian',
      email: 'divya.alumni@campus.edu',
      department: 'Robotics',
      gradYear: 2019,
      company: 'Tesla',
      designation: 'Robotics Automation Specialist',
      location: 'Palo Alto / Remote',
      skills: ['ROS', 'Computer Vision', 'Control Systems', 'C++'],
      domains: ['core_engineering', 'software_engineering'],
      mentorshipAvailable: true,
      maxActiveMentees: 2,
      activeMenteeCount: 0,
      ratingAvg: 4.7,
      ratingCount: 5,
      isVerified: true,
      openToReferrals: true,
    },
    {
      name: 'Rohan Varma',
      email: 'rohan.alumni@campus.edu',
      department: 'CSE (Cyber Security)',
      gradYear: 2023,
      company: 'CrowdStrike',
      designation: 'Security Analyst',
      location: 'Pune',
      skills: ['Penetration Testing', 'SIEM', 'Cloud Security'],
      domains: ['cybersecurity'],
      mentorshipAvailable: true,
      maxActiveMentees: 3,
      activeMenteeCount: 0,
      ratingAvg: 4.6,
      ratingCount: 3,
      isVerified: true,
      openToReferrals: false,
      privacy: { email: 'hidden', phone: 'hidden', company: 'public', designation: 'public', location: 'public', linkedin: 'public' },
    },
    {
      name: 'Sneha Pillai',
      email: 'sneha.alumni@campus.edu',
      department: 'VLSI',
      gradYear: 2021,
      company: 'Intel',
      designation: 'Silicon Design Engineer',
      location: 'Bengaluru',
      skills: ['Physical Design', 'Static Timing Analysis', 'Cadence'],
      domains: ['core_engineering'],
      mentorshipAvailable: false,
      maxActiveMentees: 2,
      activeMenteeCount: 0,
      ratingAvg: 0,
      ratingCount: 0,
      isVerified: true,
      openToReferrals: true,
    },
    {
      name: 'Vignesh Kumar',
      email: 'vignesh.alumni@campus.edu',
      department: 'Agri',
      gradYear: 2020,
      company: 'AgNext Technologies',
      designation: 'Agritech Lead',
      location: 'Chennai',
      skills: ['Precision Agriculture', 'IoT Sensors', 'Supply Chain Tech'],
      domains: ['entrepreneurship', 'other'],
      mentorshipAvailable: true,
      maxActiveMentees: 4,
      activeMenteeCount: 0,
      ratingAvg: 4.9,
      ratingCount: 8,
      isVerified: true,
      openToReferrals: true,
    },
    {
      name: 'Meenakshi Sundaram',
      email: 'meenakshi.alumni@campus.edu',
      department: 'Bio Medical',
      gradYear: 2024,
      company: 'Siemens Healthineers',
      designation: 'Associate Bio-Engineer',
      location: 'Bengaluru',
      skills: ['Medical Imaging', 'Biomedical Instrumentation', 'MATLAB'],
      domains: ['core_engineering', 'higher_studies'],
      mentorshipAvailable: true,
      maxActiveMentees: 2,
      activeMenteeCount: 0,
      ratingAvg: 0,
      ratingCount: 0,
      isVerified: false, // unverified demo profile
      openToReferrals: true,
    },
  ];

  const seededUsers = [];
  const seededProfiles = [];

  for (const item of alumniData) {
    let user = await User.findOne({ email: item.email });
    if (!user) {
      user = new User({
        name: item.name,
        email: item.email,
        password: PASSWORD,
        role: 'alumni',
        department: item.department,
        designation: item.designation,
        year: item.gradYear,
        bio: `${item.designation} at ${item.company}. Class of ${item.gradYear}. Passionate about giving back to junior students.`,
      });
      await user.save();
    }
    seededUsers.push(user);

    const profile = new AlumniProfile({
      user: user._id,
      gradYear: item.gradYear,
      company: item.company,
      designation: item.designation,
      currentLocation: item.location,
      skills: item.skills,
      domains: item.domains,
      mentorshipAvailable: item.mentorshipAvailable,
      maxActiveMentees: item.maxActiveMentees,
      activeMenteeCount: item.activeMenteeCount,
      ratingAvg: item.ratingAvg,
      ratingCount: item.ratingCount,
      openToReferrals: item.openToReferrals,
      isVerified: item.isVerified,
      verifiedBy: item.isVerified ? (admin ? admin._id : null) : null,
      verifiedAt: item.isVerified ? new Date() : null,
      social: {
        linkedin: `https://linkedin.com/in/${item.email.split('@')[0]}`,
        github: `https://github.com/${item.email.split('@')[0]}`,
      },
      privacy: item.privacy || undefined,
    });
    await profile.save();
    seededProfiles.push(profile);
  }

  const karthik = seededUsers[0];
  const pooja = seededUsers[1];
  const aravind = seededUsers[2];

  // 2. Mentorship Requests & Sessions
  if (student) {
    // Completed & Rated request with Karthik
    const completedReq = new MentorshipRequest({
      student: student._id,
      alumni: karthik._id,
      domain: 'software_engineering',
      message: 'Hi Karthik, I would love guidance on preparing for large-scale distributed systems interviews.',
      status: 'completed',
      response: 'Glad to help! Lets set up a mock system design interview.',
      respondedAt: new Date(Date.now() - 14 * DAY),
      completedAt: new Date(Date.now() - 2 * DAY),
      rating: 5,
      review: 'Incredible session! Karthik gave me exact architecture patterns and actionable feedback.',
      goals: [
        { text: 'Understand Sharding & Replication', done: true },
        { text: 'Mock Design: URL Shortener', done: true },
        { text: 'Resume Critique', done: true },
      ],
    });
    await completedReq.save();

    // Active accepted request with Karthik
    const activeReq = new MentorshipRequest({
      student: student._id,
      alumni: karthik._id,
      domain: 'software_engineering',
      message: 'Looking for follow-up mentoring on microservices resiliency patterns and Kafka.',
      status: 'accepted',
      response: 'Sounds great! Book a slot on my calendar.',
      respondedAt: new Date(Date.now() - 2 * DAY),
      goals: [
        { text: 'Event-driven architectures', done: false },
        { text: 'Observability & OpenTelemetry', done: false },
      ],
    });
    await activeReq.save();

    // Pending request with Pooja
    const pendingReq = new MentorshipRequest({
      student: student._id,
      alumni: pooja._id,
      domain: 'core_engineering',
      message: 'Hello Maam, I am interested in FPGA design and semiconductor careers. Seeking your mentorship.',
      status: 'pending',
      expiresAt: daysFromNow(5),
    });
    await pendingReq.save();

    // 3. Mentorship Slots
    const slot1 = new MentorshipSlot({
      alumni: karthik._id,
      startsAt: daysFromNow(2, 18),
      durationMin: 45,
      mode: 'video',
      meetingLink: 'https://meet.google.com/cmp-seed-slot',
      status: 'booked',
      bookedBy: student._id,
    });
    await slot1.save();

    const slot2 = new MentorshipSlot({
      alumni: karthik._id,
      startsAt: daysFromNow(4, 17),
      durationMin: 30,
      mode: 'video',
      meetingLink: 'https://meet.google.com/cmp-karthik-open',
      status: 'open',
    });
    await slot2.save();

    const slot3 = new MentorshipSlot({
      alumni: pooja._id,
      startsAt: daysFromNow(3, 16),
      durationMin: 45,
      mode: 'video',
      meetingLink: 'https://meet.google.com/cmp-pooja-slot',
      status: 'open',
    });
    await slot3.save();

    const slot4 = new MentorshipSlot({
      alumni: aravind._id,
      startsAt: daysFromNow(2, 19),
      durationMin: 30,
      mode: 'video',
      meetingLink: 'https://meet.google.com/cmp-aravind-open',
      status: 'open',
    });
    await slot4.save();

    // 4. Mentorship Session (Confirmed upcoming)
    const session = new MentorshipSession({
      request: activeReq._id,
      slot: slot1._id,
      student: student._id,
      alumni: karthik._id,
      startsAt: slot1.startsAt,
      durationMin: 45,
      mode: 'video',
      meetingLink: slot1.meetingLink,
      agenda: 'Deep dive into event sourcing and idempotent consumers',
      status: 'confirmed',
      actionItems: [
        { text: 'Review Martin Kleppmann chapter 11', done: false },
        { text: 'Bring snippet of current project repository', done: true },
      ],
    });
    await session.save();
  }

  // 5. Jobs & Applications
  const job1 = new AlumniJob({
    poster: karthik._id,
    title: 'Software Engineer - Cloud Infrastructure',
    company: 'Google India',
    location: 'Bengaluru / Hybrid',
    type: 'full_time',
    workMode: 'hybrid',
    description: 'Join our Cloud Spanner team building globally distributed transactional storage engines. Strong experience in C++, Go or Java required.',
    skills: ['Go', 'C++', 'Distributed Systems', 'Cloud'],
    applyMode: 'referral',
    deadline: daysFromNow(30),
    status: 'open',
    applicationCount: 2,
  });
  await job1.save();

  const job2 = new AlumniJob({
    poster: pooja._id,
    title: 'Hardware Verification Intern (Summer 2026)',
    company: 'Qualcomm',
    location: 'Hyderabad',
    type: 'internship',
    workMode: 'onsite',
    description: 'Hands-on verification of next-generation Snapdragon DSP blocks using SystemVerilog and UVM. Pre-final year students eligible.',
    skills: ['SystemVerilog', 'UVM', 'VLSI', 'Digital Design'],
    applyMode: 'referral',
    deadline: daysFromNow(20),
    status: 'open',
    applicationCount: 1,
  });
  await job2.save();

  const job3 = new AlumniJob({
    poster: aravind._id,
    title: 'Applied AI & ML Research Engineer',
    company: 'Microsoft',
    location: 'Bengaluru',
    type: 'full_time',
    workMode: 'hybrid',
    description: 'Work with the Azure AI Cognitive Services group fine-tuning multimodal models for enterprise document understanding.',
    skills: ['Python', 'PyTorch', 'HuggingFace', 'NLP'],
    applyMode: 'external_link',
    externalUrl: 'https://careers.microsoft.com/us/en/job/demo-cmp-1234',
    deadline: daysFromNow(25),
    status: 'open',
    applicationCount: 0,
  });
  await job3.save();

  const job4 = new AlumniJob({
    poster: seededUsers[4]._id, // Rohan
    title: 'Associate SOC Analyst',
    company: 'CrowdStrike',
    location: 'Pune',
    type: 'full_time',
    workMode: 'onsite',
    description: 'Monitor, detect, and investigate malicious activity across customer endpoints.',
    skills: ['Cybersecurity', 'Wireshark', 'Splunk'],
    applyMode: 'referral',
    deadline: new Date(Date.now() - 5 * DAY),
    status: 'expired',
    applicationCount: 1,
  });
  await job4.save();

  if (student) {
    const app1 = new JobApplication({
      job: job1._id,
      student: student._id,
      note: 'I have contributed to Apache Kafka and built distributed storage toy projects. Would love an internal referral!',
      referralRequested: true,
      status: 'referred',
      posterNote: 'Strong portfolio and clear system design acumen. Submitted referral to Google hiring portal.',
    });
    await app1.save();

    const app2 = new JobApplication({
      job: job2._id,
      student: student._id,
      note: 'Top of class in VLSI and microcontrollers. Looking forward to verification work.',
      referralRequested: true,
      status: 'shortlisted',
      posterNote: 'Reviewed transcript and project work. Shortlisted for technical round.',
    });
    await app2.save();
  }

  // 6. Alumni Events
  const event1 = new AlumniEvent({
    organizer: admin ? admin._id : karthik._id,
    title: 'Grand Annual Alumni Homecoming & Gala 2026',
    type: 'reunion',
    mode: 'in_person',
    startsAt: daysFromNow(14, 10),
    endsAt: daysFromNow(14, 18),
    venue: 'Main Auditorium & Green Meadows Campus Lawn',
    description: 'Welcome back home! Connect with fellow alumni across batches, meet our faculty, tour new lab facilities, and celebrate alumni achievements.',
    capacity: 350,
    status: 'scheduled',
  });
  await event1.save();

  const event2 = new AlumniEvent({
    organizer: karthik._id,
    title: 'Breaking Into Big Tech: AMA & Live Resume Teardown',
    type: 'webinar',
    mode: 'online',
    startsAt: daysFromNow(3, 19),
    endsAt: daysFromNow(3, 20),
    meetingLink: 'https://meet.google.com/cmp-bigtech-ama',
    description: 'Practical tactics for clearing tech screening, behavioral rounds, and structuring high-impact portfolio projects.',
    capacity: 2, // low capacity to demonstrate waitlist promotion
    status: 'scheduled',
  });
  await event2.save();

  const event3 = new AlumniEvent({
    organizer: pooja._id,
    title: 'Semiconductor Trends: India Semiconductor Mission & You',
    type: 'guest_talk',
    mode: 'hybrid',
    startsAt: daysFromNow(7, 15),
    endsAt: daysFromNow(7, 17),
    venue: 'ECE Seminar Hall & Webex',
    description: 'An insightful discussion on chip manufacturing, VLSI startups in India, and how students can position themselves.',
    capacity: 100,
    status: 'pending_approval',
  });
  await event3.save();

  if (student) {
    const rsvp1 = new AlumniEventRsvp({
      event: event1._id,
      user: student._id,
      status: 'going',
    });
    await rsvp1.save();

    const rsvp2 = new AlumniEventRsvp({
      event: event2._id,
      user: student._id,
      status: 'going',
    });
    await rsvp2.save();
  }

  // 7. Chapters & Posts
  const chapBatch = new Chapter({
    name: 'Batch of 2022',
    slug: 'batch-of-2022',
    type: 'batch',
    gradYear: 2022,
    description: 'Official chapter for the graduated class of 2022. Stay connected, share milestones, and collaborate.',
    isPrivate: false,
    memberCount: 3,
  });
  await chapBatch.save();

  const chapCSE = new Chapter({
    name: 'CSE Alumni Network',
    slug: 'cse-alumni-network',
    type: 'department',
    department: 'CSE',
    description: 'Network for Computer Science Engineering alumni across all graduation years.',
    isPrivate: false,
    memberCount: 4,
  });
  await chapCSE.save();

  const chapBLR = new Chapter({
    name: 'Bengaluru Alumni Hub',
    slug: 'bengaluru-alumni-hub',
    type: 'city',
    description: 'Connect, network, and meetup with fellow alumni working in Bengaluru Silicon Valley.',
    isPrivate: false,
    memberCount: 5,
  });
  await chapBLR.save();

  // Add memberships
  for (const u of [karthik, aravind, pooja]) {
    await ChapterMember.create({ chapter: chapBLR._id, user: u._id, role: u._id.equals(karthik._id) ? 'moderator' : 'member', status: 'active' });
    await ChapterMember.create({ chapter: chapCSE._id, user: u._id, role: 'member', status: 'active' });
  }

  // Posts on Bengaluru Hub
  const post1 = new ChapterPost({
    chapter: chapBLR._id,
    author: karthik._id,
    body: '👋 Welcome to the Bengaluru Alumni Hub! We are planning an informal coffee meetup next weekend around Indiranagar. Who is interested?',
    kind: 'announcement',
    isPinned: true,
    likeCount: 4,
    commentCount: 2,
    likes: [aravind._id, pooja._id],
  });
  await post1.save();

  await ChapterComment.create({
    post: post1._id,
    author: aravind._id,
    body: 'Count me in! Saturday afternoon works great.',
  });
  await ChapterComment.create({
    post: post1._id,
    author: pooja._id,
    body: 'Would love to join as well. Indiranagar is super convenient.',
  });

  const post2 = new ChapterPost({
    chapter: chapCSE._id,
    author: aravind._id,
    body: 'Our Microsoft team has opened several junior and senior positions in Azure AI. Check the Alumni Jobs tab or DM me directly for referrals!',
    kind: 'post',
    likeCount: 6,
    commentCount: 0,
    likes: [karthik._id],
  });
  await post2.save();

  // 8. Import Batch & Invites
  const batch = new AlumniImportBatch({
    uploader: admin ? admin._id : hodCSE._id,
    filename: 'alumni_2025_passouts_verified.csv',
    status: 'done',
    summary: { total: 3, valid: 3, invalid: 0, duplicates: 0, existing: 0 },
    emailsSent: 2,
  });
  await batch.save();

  const token1 = crypto.randomBytes(32).toString('hex');
  const hash1 = crypto.createHash('sha256').update(token1).digest('hex');
  const invite1 = new AlumniInvite({
    batch: batch._id,
    tokenHash: hash1,
    email: 'ananya.invite@example.com',
    name: 'Ananya Ramesh',
    department: 'CSE',
    gradYear: 2023,
    company: 'Amazon Web Services',
    designation: 'Cloud Support Associate',
    status: 'pending',
    expiresAt: daysFromNow(14),
  });
  await invite1.save();

  const token2 = crypto.randomBytes(32).toString('hex');
  const hash2 = crypto.createHash('sha256').update(token2).digest('hex');
  const invite2 = new AlumniInvite({
    batch: batch._id,
    tokenHash: hash2,
    email: 'karthik.alumni@campus.edu',
    name: 'Karthik Ramachandran',
    department: 'CSE',
    gradYear: 2021,
    status: 'claimed',
    claimedAt: new Date(Date.now() - 30 * DAY),
    claimedUser: karthik._id,
  });
  await invite2.save();

  console.log('[alumni-seed] Seeded 8 alumni profiles, mentorship requests, slots, sessions, jobs, events, chapters, posts, and invites successfully.');
}
