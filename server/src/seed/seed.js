/**
 * Demo data seeder.  Usage:  npm run seed
 * WARNING: wipes the CampusConnect collections in the configured database.
 */
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Club from '../models/Club.js';
import Event from '../models/Event.js';
import Announcement from '../models/Announcement.js';
import Discussion from '../models/Discussion.js';
import Notification from '../models/Notification.js';
import Report from '../models/Report.js';
import Activity from '../models/Activity.js';
import Subject from '../models/Subject.js';
import TimetableSlot from '../models/TimetableSlot.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceCorrectionRequest from '../models/AttendanceCorrectionRequest.js';
import GatePass from '../models/GatePass.js';
import LostFoundItem from '../models/LostFoundItem.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Session from '../models/Session.js';
import LoginHistory from '../models/LoginHistory.js';
import { seedAcademic } from './academic.js';

const PASSWORD = 'Password@123';
const DAY = 86400000;
const days = (n, hour = 10) => {
  const d = new Date(Date.now() + n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const pickN = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

const DEPARTMENTS = ['CSE', 'CSE (Cyber Security)', 'ECE', 'EEE', 'IT', 'AI & DS', 'Mechanical', 'Civil'];

async function seed() {
  await connectDB();
  console.log('[seed] Clearing collections…');
  await Promise.all(
    [
      User, Club, Event, Announcement, Discussion, Notification, Report, Activity,
      Subject, TimetableSlot, AttendanceRecord, AttendanceCorrectionRequest,
      GatePass, LostFoundItem, Conversation, Message, Session, LoginHistory,
    ].map((m) => m.deleteMany({}))
  );

  // ── Users ────────────────────────────────────────────────────────
  const mk = (u) => new User({ password: PASSWORD, ...u });
  const admin = mk({
    name: 'Anita Raman',
    email: 'admin@campus.edu',
    role: 'admin',
    department: 'Administration',
    designation: 'Dean of Student Affairs',
  });
  const faculty = mk({
    name: 'Dr. Suresh Kumar',
    email: 'faculty@campus.edu',
    role: 'faculty',
    department: 'CSE',
    designation: 'Associate Professor',
    interests: ['technical', 'hackathon', 'ai'],
  });
  const faculty2 = mk({
    name: 'Prof. Meera Iyer',
    email: 'meera@campus.edu',
    role: 'faculty',
    department: 'ECE',
    designation: 'Assistant Professor',
    interests: ['cultural', 'arts'],
  });
  const hod = mk({
    name: 'Dr. Lakshmi Narayanan',
    email: 'hod@campus.edu',
    role: 'hod',
    department: 'CSE',
    employeeId: 'EMP-HOD-CSE',
    designation: 'Professor & Head, CSE',
    phone: '9840012345',
  });
  const principal = mk({
    name: 'Dr. Ramesh Babu',
    email: 'principal@campus.edu',
    role: 'principal',
    employeeId: 'EMP-PRINCIPAL',
    designation: 'Principal',
    phone: '9840054321',
  });
  const clubAdmin = mk({
    name: 'Rahul Verma',
    email: 'clubadmin@campus.edu',
    role: 'club_admin',
    department: 'CSE (Cyber Security)',
    year: 3,
    rollNo: '22CS301',
    skills: ['python', 'linux', 'networking', 'ctf'],
    interests: ['technical', 'hackathon', 'security'],
    bio: 'Lead of the Cyber Security Club. Loves CTFs and packet captures.',
  });
  const clubAdmin2 = mk({
    name: 'Sneha Pillai',
    email: 'sneha@campus.edu',
    role: 'club_admin',
    department: 'ECE',
    year: 3,
    rollNo: '22EC118',
    skills: ['dance', 'event management'],
    interests: ['cultural', 'arts', 'social'],
    bio: 'Coordinator, Rhythm Cultural Club.',
  });

  const studentSeed = [
    ['Divya Krishnan', 'student@campus.edu', 'CSE', 3, ['react', 'node.js', 'mongodb'], ['technical', 'hackathon', 'workshop']],
    ['Arjun Nair', 'arjun@campus.edu', 'IT', 2, ['java', 'spring'], ['technical', 'sports']],
    ['Priya Sharma', 'priya@campus.edu', 'AI & DS', 3, ['python', 'pytorch', 'ml'], ['technical', 'ai', 'seminar']],
    ['Karthik Reddy', 'karthik@campus.edu', 'Mechanical', 4, ['cad', 'solidworks'], ['sports', 'workshop']],
    ['Fatima Sheikh', 'fatima@campus.edu', 'CSE (Cyber Security)', 2, ['networking', 'wireshark'], ['technical', 'security', 'hackathon']],
    ['Vikram Singh', 'vikram@campus.edu', 'EEE', 3, ['embedded c', 'arduino'], ['technical', 'workshop']],
    ['Ananya Das', 'ananya@campus.edu', 'ECE', 1, ['singing', 'photoshop'], ['cultural', 'arts']],
    ['Rohan Mehta', 'rohan@campus.edu', 'Civil', 2, ['autocad'], ['sports', 'social']],
    ['Lakshmi Menon', 'lakshmi@campus.edu', 'CSE', 4, ['flutter', 'firebase'], ['technical', 'career']],
    ['Aditya Joshi', 'aditya@campus.edu', 'IT', 1, ['c++', 'dsa'], ['technical', 'hackathon']],
    ['Nisha Patel', 'nisha@campus.edu', 'AI & DS', 2, ['sql', 'tableau'], ['career', 'seminar']],
    ['Siddharth Rao', 'siddharth@campus.edu', 'CSE (Cyber Security)', 3, ['pentesting', 'bash'], ['security', 'technical']],
  ];
  const students = studentSeed.map(([name, email, department, year, skills, interests], i) =>
    mk({
      name,
      email,
      department,
      year,
      rollNo: `2${4 - year}${department.slice(0, 2).toUpperCase()}${100 + i}`,
      skills,
      interests,
      role: 'student',
      bio: `${department} student · Year ${year}`,
      extracurriculars: pickN(['NSS', 'NCC', 'Robotics', 'Debate', 'Photography', 'Music'], 2),
      achievements:
        i % 3 === 0 ? [{ title: 'Smart India Hackathon — Finalist', description: 'National level', date: days(-120) }] : [],
    })
  );

  const allUsers = [admin, faculty, faculty2, hod, principal, clubAdmin, clubAdmin2, ...students];
  for (const u of allUsers) await u.save();
  console.log(`[seed] ${allUsers.length} users`);

  // ── Clubs ────────────────────────────────────────────────────────
  const clubDefs = [
    {
      name: 'Cyber Security Club',
      tagline: 'Break it, then secure it.',
      description:
        'Hands-on security community: weekly CTF practice, network defence labs, bug bounty walkthroughs and talks from industry professionals.',
      category: 'technical',
      tags: ['security', 'ctf', 'networking', 'hackathon'],
      admins: [clubAdmin],
      facultyAdvisor: faculty,
      members: [clubAdmin, students[0], students[4], students[11], students[9], students[2]],
    },
    {
      name: 'Code Crafters',
      tagline: 'Build real things with real code.',
      description:
        'Full-stack development club running project sprints, open-source contribution drives and competitive programming practice every weekend.',
      category: 'technical',
      tags: ['web', 'react', 'dsa', 'open-source'],
      admins: [students[0]],
      facultyAdvisor: faculty,
      members: [students[0], students[1], students[8], students[9], students[2], clubAdmin],
    },
    {
      name: 'Rhythm Cultural Club',
      tagline: 'Dance, music and everything in between.',
      description:
        'The home of campus performances — dance crews, band nights, theatre workshops and the annual cultural fest.',
      category: 'cultural',
      tags: ['dance', 'music', 'theatre'],
      admins: [clubAdmin2],
      facultyAdvisor: faculty2,
      members: [clubAdmin2, students[6], students[7], students[10]],
    },
    {
      name: 'Athletics & Sports Council',
      tagline: 'Train hard. Play fair.',
      description:
        'Coordinates inter-department tournaments, fitness drives and represents the college at university-level sports meets.',
      category: 'sports',
      tags: ['cricket', 'football', 'fitness'],
      admins: [students[3]],
      members: [students[3], students[1], students[7], students[5]],
    },
    {
      name: 'AI Research Circle',
      tagline: 'Papers, models and curious minds.',
      description:
        'Weekly paper-reading sessions, Kaggle team-ups and mini research projects in machine learning, NLP and computer vision.',
      category: 'technical',
      tags: ['ai', 'ml', 'research'],
      admins: [students[2]],
      facultyAdvisor: faculty,
      members: [students[2], students[10], students[0], students[8]],
    },
    {
      name: 'Green Earth Initiative',
      tagline: 'Small actions, big impact.',
      description: 'Tree plantation drives, campus clean-ups and sustainability awareness programmes with local NGOs.',
      category: 'social-service',
      tags: ['environment', 'volunteering', 'social'],
      admins: [students[7]],
      members: [students[7], students[6]],
    },
  ];

  const clubs = [];
  for (const def of clubDefs) {
    const club = await Club.create({
      ...def,
      admins: def.admins.map((u) => u._id),
      members: def.members.map((u) => u._id),
      facultyAdvisor: def.facultyAdvisor?._id,
      createdBy: def.admins[0]._id,
      status: 'approved',
      contactEmail: `${def.name.split(' ')[0].toLowerCase()}@campus.edu`,
    });
    clubs.push(club);
    await User.updateMany({ _id: { $in: club.members } }, { $addToSet: { clubs: club._id } });
  }

  // One pending request to show the approval workflow.
  const pending = await Club.create({
    name: 'Photography Society',
    tagline: 'Capture campus life.',
    description: 'Photo walks, editing workshops and a yearly campus photo exhibition. Open to all skill levels.',
    category: 'arts',
    tags: ['photography', 'arts'],
    admins: [students[6]._id],
    members: [students[6]._id],
    createdBy: students[6]._id,
    status: 'pending',
  });
  clubs[0].pendingRequests.push({ user: students[1]._id, message: 'Keen to learn CTFs!' });
  clubs[0].pendingRequests.push({ user: students[5]._id, message: 'Interested in network security.' });
  await clubs[0].save();
  console.log(`[seed] ${clubs.length + 1} clubs`);

  // ── Events ───────────────────────────────────────────────────────
  const eventDefs = [
    ['CTF Night: Capture The Flag', 'hackathon', 0, clubAdmin, 3, 'Cyber Lab, Block C', 40, ['ctf', 'security', 'hackathon'], true],
    ['Web Security Workshop: OWASP Top 10', 'workshop', 0, clubAdmin, 8, 'Seminar Hall 2', 60, ['security', 'web'], false],
    ['24-Hour Build-a-thon', 'hackathon', 1, students[0], 12, 'Innovation Centre', 100, ['hackathon', 'web', 'technical'], true],
    ['React & Node Crash Course', 'workshop', 1, students[0], 5, 'Lab 204', 3, ['react', 'web', 'technical'], false],
    ['Rhythm Fest 2026', 'cultural', 2, clubAdmin2, 20, 'Open Air Theatre', 500, ['dance', 'music', 'cultural'], true],
    ['Inter-Department Cricket League', 'sports', 3, students[3], 15, 'Main Ground', 0, ['cricket', 'sports'], false],
    ['Intro to LLMs — Paper Reading', 'seminar', 4, students[2], 6, 'AI Lab', 30, ['ai', 'ml', 'seminar'], false],
    ['Campus Clean-up Drive', 'social', 5, students[7], 9, 'Main Gate', 0, ['environment', 'social'], false],
    ['Placement Prep: Mock Interviews', 'career', null, faculty, 10, 'Placement Cell', 80, ['career', 'placements'], false],
    ['Network Defence Bootcamp', 'workshop', 0, clubAdmin, -20, 'Cyber Lab, Block C', 40, ['security', 'networking'], false],
    ['Freshers Cultural Night', 'cultural', 2, clubAdmin2, -35, 'Auditorium', 400, ['cultural', 'music'], false],
    ['Kaggle Kickoff Meetup', 'technical', 4, students[2], -50, 'AI Lab', 30, ['ai', 'ml'], false],
    ['Guest Lecture: Cloud Security Careers', 'seminar', null, faculty, -75, 'Main Auditorium', 300, ['security', 'career'], false],
    ['Code Sprint #1', 'technical', 1, students[0], -110, 'Lab 204', 50, ['web', 'dsa'], false],
    ['Sports Day 2026', 'sports', 3, students[3], -140, 'Main Ground', 0, ['sports', 'fitness'], false],
  ];

  const everyone = [clubAdmin, clubAdmin2, ...students];
  const events = [];
  for (const [title, category, clubIdx, organizer, offset, venue, capacity, tags, isFeatured] of eventDefs) {
    const start = days(offset, 10);
    const end = new Date(start.getTime() + (category === 'hackathon' ? 24 : 3) * 3600000);
    const past = offset < 0;
    const want = capacity ? Math.min(capacity, 3 + Math.floor(Math.random() * 8)) : 4 + Math.floor(Math.random() * 7);
    const attendees = pickN(everyone, Math.min(want, everyone.length));
    const registrations = attendees.map((u, i) => ({
      user: u._id,
      status: past ? (i % 4 === 0 ? 'registered' : 'attended') : 'registered',
      registeredAt: new Date(start.getTime() - (5 + Math.random() * 25) * DAY),
    }));
    const extra =
      capacity && capacity <= 3
        ? pickN(everyone.filter((u) => !attendees.includes(u)), 2).map((u) => ({
            user: u._id,
            status: 'waitlisted',
            registeredAt: new Date(start.getTime() - 2 * DAY),
          }))
        : [];
    events.push(
      await Event.create({
        title,
        category,
        club: clubIdx === null ? undefined : clubs[clubIdx]._id,
        organizer: organizer._id,
        description: `${title} — organised ${clubIdx === null ? 'by the college' : `by ${clubs[clubIdx].name}`}. Join us for an engaging session with hands-on activities, networking and certificates for all participants. Bring your college ID.`,
        startDate: start,
        endDate: end,
        registrationDeadline: past ? undefined : new Date(start.getTime() - DAY),
        venue,
        capacity,
        registrations: [...registrations, ...extra],
        registeredCount: registrations.length,
        tags,
        isFeatured,
      })
    );
  }
  console.log(`[seed] ${events.length} events`);

  // ── Announcements ────────────────────────────────────────────────
  const annDefs = [
    [admin, 'End-semester examination schedule released', 'The end-semester theory examination timetable is now available on the exam cell notice board. Hall tickets will be issued from next Monday. Clear all dues before collecting your hall ticket.', 'urgent', { scope: 'all' }, true, 7],
    [faculty, 'CSE: Project review — Phase 1', 'Final-year CSE project teams must submit abstract and literature survey to their guides. Review panels will be announced separately.', 'important', { scope: 'department', department: 'CSE' }, false, 10],
    [admin, 'Library timings extended during exams', 'The central library will remain open until 10 PM on all working days during the examination period.', 'normal', { scope: 'all' }, false, null],
    [clubAdmin, 'CTF Night registrations are open!', 'Teams of up to 3. Beginners welcome — we will run a 30-minute warm-up on Linux basics and web exploitation before the flags drop.', 'important', { scope: 'club', club: clubs[0]._id }, false, 2],
    [faculty2, 'Scholarship applications — last date', 'Eligible students may apply for the merit-cum-means scholarship. Upload documents through the student section of the office.', 'important', { scope: 'all' }, false, 14],
    [clubAdmin2, 'Rhythm Fest auditions this Friday', 'Solo and group auditions for dance, singing and instrumentals in the auditorium from 3 PM.', 'normal', { scope: 'club', club: clubs[2]._id }, false, 4],
    [admin, 'Campus Wi-Fi maintenance on Sunday', 'Network maintenance is scheduled from 6 AM to 12 PM this Sunday. Expect intermittent connectivity across all blocks.', 'normal', { scope: 'all' }, false, null],
  ];
  for (const [i, [author, title, content, priority, audience, isPinned, deadlineIn]] of annDefs.entries()) {
    await Announcement.create({
      author: author._id,
      title,
      content,
      priority,
      audience,
      isPinned,
      deadline: deadlineIn ? days(deadlineIn, 17) : undefined,
      createdAt: new Date(Date.now() - i * 0.7 * DAY),
    });
  }
  console.log(`[seed] ${annDefs.length} announcements`);

  // ── Discussions ──────────────────────────────────────────────────
  const discDefs = [
    [students[0], 'Best resources to prepare for placements in 3rd year?', 'I want to start preparing early. What worked for your seniors — LeetCode, aptitude books, mock interviews? Please share a roadmap.', 'placements', ['placements', 'dsa']],
    [students[4], 'How do I get started with CTFs as a beginner?', 'I know basic Linux and networking. Which platforms should I start with, and does the Cyber Security Club run beginner sessions?', 'clubs', ['ctf', 'security']],
    [students[2], 'Study group for Machine Learning (unit 3)?', 'Looking for 3–4 people to go through SVMs and kernel methods before internals. We can meet in the library.', 'academics', ['ml', 'study-group']],
    [students[1], 'Is the hostel Wi-Fi slow for everyone?', 'Speeds drop to almost nothing after 9 PM in Block B. Anyone else? Should we raise a ticket together?', 'help', ['hostel', 'wifi']],
    [students[8], 'Rhythm Fest volunteers needed', 'We need volunteers for stage management, registration desk and hospitality. Certificates for all volunteers!', 'events', ['volunteering', 'fest']],
    [students[9], 'Which elective is better: Cloud Computing or Blockchain?', 'Confused between the two electives next semester. Seniors, which one has better faculty and project scope?', 'academics', ['electives']],
  ];
  const replyPool = [
    'Great question — following this thread!',
    'Start with Striver\'s SDE sheet and do 2 problems a day consistently.',
    'The club runs beginner sessions every Wednesday at 4 PM in the Cyber Lab.',
    'Count me in. I can share my notes too.',
    'Yes, same issue in Block A. Let\'s raise a ticket with IT.',
    'Cloud Computing — more industry demand and hands-on labs with AWS.',
    'picoCTF and OverTheWire Bandit are perfect for beginners.',
    'I\'d love to volunteer for the registration desk.',
  ];
  for (const [i, [author, title, body, category, tags]] of discDefs.entries()) {
    const repliers = pickN(everyone.filter((u) => u !== author), 2 + (i % 3));
    await Discussion.create({
      author: author._id,
      title,
      body,
      category,
      tags,
      isPinned: i === 0,
      upvotes: pickN(everyone, 2 + i).map((u) => u._id),
      replies: repliers.map((u, j) => ({
        author: u._id,
        body: replyPool[(i + j) % replyPool.length],
        upvotes: pickN(everyone, j + 1).map((x) => x._id),
        createdAt: new Date(Date.now() - (i + 1) * DAY + j * 3600000),
      })),
      lastActivityAt: new Date(Date.now() - i * 0.5 * DAY),
      views: 20 + i * 13,
      createdAt: new Date(Date.now() - (i + 2) * DAY),
    });
  }
  console.log(`[seed] ${discDefs.length} discussions`);

  // ── Notifications, reports & activity ────────────────────────────
  const demoStudent = students[0];
  await Notification.insertMany([
    { user: demoStudent._id, type: 'event', title: 'New event: 24-Hour Build-a-thon', message: 'Innovation Centre', link: `/events/${events[2]._id}` },
    { user: demoStudent._id, type: 'announcement', title: 'End-semester examination schedule released', link: '/announcements' },
    { user: demoStudent._id, type: 'club', title: 'Welcome to Cyber Security Club! 🎉', link: `/clubs/${clubs[0].slug}`, read: true },
    { user: admin._id, type: 'club', title: 'New club awaiting approval', message: 'Photography Society', link: '/admin/clubs' },
  ]);

  const flagged = await Discussion.findOne({ title: /hostel Wi-Fi/ });
  await Report.create({
    targetType: 'discussion',
    targetId: flagged._id,
    reporter: students[3]._id,
    reason: 'spam',
    details: 'Duplicate of an older thread.',
  });

  const actions = ['auth.login', 'event.register', 'discussion.reply', 'club.join_request', 'discussion.create', 'profile.update'];
  const activity = [];
  for (let d = 0; d < 14; d += 1) {
    const n = 4 + Math.floor(Math.random() * 12);
    for (let k = 0; k < n; k += 1) {
      activity.push({
        user: pickN(everyone, 1)[0]._id,
        action: actions[Math.floor(Math.random() * actions.length)],
        createdAt: new Date(Date.now() - d * DAY - Math.random() * DAY * 0.9),
      });
    }
  }
  await Activity.insertMany(activity);
  console.log(`[seed] ${activity.length} activity entries, notifications & reports`);

  // Development-only academic data (sections, subjects, timetable, attendance).
  await seedAcademic();

  console.log('\n✅ Seed complete. Demo accounts (password: %s)', PASSWORD);
  console.table([
    { role: 'admin', email: admin.email },
    { role: 'faculty', email: faculty.email },
    { role: 'club_admin', email: clubAdmin.email },
    { role: 'student', email: demoStudent.email },
  ]);
  void pending;
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('[seed] failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
