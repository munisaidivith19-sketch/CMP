/**
 * Central subject catalogue for the timetable "Add period" dropdown.
 *
 * TO ADD A SUBJECT: add `{ name: 'Subject Name', code: 'SUB101' }` to the right
 * department + semester block below and restart the server. On startup every
 * subject listed here that is not already in the database is created as a real
 * Subject record (see utils/syncSubjects.js), so the timetable stores its id.
 *
 * - `department` must match a department name used in the app (User / Subject).
 *   Cyber Security is its own department: 'CSE (Cyber Security)'.
 * - `semester` is 1–8. The year is derived automatically (semesters 1–2 = year 1 …).
 * - Codes only need to be unique within one department + semester.
 * - Existing subjects are never overwritten or deleted by this file — edit or
 *   retire them from Academics → Subjects instead.
 * - Optional per subject: `type: 'lab' | 'elective'` (default 'theory'), `credits`.
 */

const DEPARTMENTS = ['CSE (Cyber Security)', 'CSE', 'AI & DS', 'ECE', 'VLSI', 'Robotics', 'Agri', 'Bio Medical'];

// First year (semesters 1–2) is common to every department.
const FIRST_YEAR = {
  1: [
    { name: 'Engineering Mathematics I', code: 'MA101' },
    { name: 'Engineering Physics', code: 'PH101' },
    { name: 'Engineering Chemistry', code: 'CH101' },
    { name: 'Problem Solving using C', code: 'GE101' },
    { name: 'Communicative English', code: 'HS101' },
    { name: 'Physics & Chemistry Lab', code: 'GE102', type: 'lab', credits: 2 },
  ],
  2: [
    { name: 'Engineering Mathematics II', code: 'MA201' },
    { name: 'Basic Electrical & Electronics Engineering', code: 'GE201' },
    { name: 'Engineering Graphics', code: 'GE202' },
    { name: 'Programming in Python', code: 'GE203' },
    { name: 'Environmental Science', code: 'HS201' },
    { name: 'Programming Lab', code: 'GE204', type: 'lab', credits: 2 },
  ],
};

/** Department-specific subjects for semesters 3–8. */
const BY_DEPARTMENT = {
  CSE: {
    3: [
      { name: 'Data Structures', code: 'CS301' },
      { name: 'Digital Principles & Computer Organization', code: 'CS302' },
      { name: 'Object Oriented Programming', code: 'CS303' },
      { name: 'Discrete Mathematics', code: 'MA301' },
      { name: 'Data Structures Lab', code: 'CS304', type: 'lab', credits: 2 },
    ],
    4: [
      { name: 'Design & Analysis of Algorithms', code: 'CS401' },
      { name: 'Operating Systems', code: 'CS402' },
      { name: 'Theory of Computation', code: 'CS403' },
      { name: 'Probability & Statistics', code: 'MA401' },
      { name: 'Operating Systems Lab', code: 'CS404', type: 'lab', credits: 2 },
    ],
    5: [
      { name: 'Compiler Design', code: 'CS501', credits: 4 },
      { name: 'Computer Networks', code: 'CS502', credits: 4 },
      { name: 'Database Management Systems', code: 'CS503' },
      { name: 'Software Engineering', code: 'CS504' },
      { name: 'Networks Lab', code: 'CS505', type: 'lab', credits: 2 },
    ],
    6: [
      { name: 'Artificial Intelligence', code: 'CS601' },
      { name: 'Web Technologies', code: 'CS602' },
      { name: 'Cloud Computing', code: 'CS603' },
      { name: 'Distributed Systems', code: 'CS604' },
      { name: 'Web Technologies Lab', code: 'CS605', type: 'lab', credits: 2 },
    ],
    7: [
      { name: 'Machine Learning', code: 'CS701' },
      { name: 'Cryptography & Network Security', code: 'CS702' },
      { name: 'Big Data Analytics', code: 'CS703', type: 'elective' },
      { name: 'Mobile Application Development', code: 'CS704', type: 'elective' },
    ],
    8: [
      { name: 'Project Work', code: 'CS801', credits: 10 },
      { name: 'Professional Ethics', code: 'HS801' },
    ],
  },
  'CSE (Cyber Security)': {
    3: [
      { name: 'Data Structures', code: 'CY301' },
      { name: 'Computer Organization & Architecture', code: 'CY302' },
      { name: 'Fundamentals of Cyber Security', code: 'CY303' },
      { name: 'Discrete Mathematics', code: 'MA301' },
      { name: 'Data Structures Lab', code: 'CY304', type: 'lab', credits: 2 },
    ],
    4: [
      { name: 'Operating Systems & Security', code: 'CY401' },
      { name: 'Design & Analysis of Algorithms', code: 'CY402' },
      { name: 'Computer Networks', code: 'CY403' },
      { name: 'Cryptography', code: 'CY404' },
      { name: 'Networks Lab', code: 'CY405', type: 'lab', credits: 2 },
    ],
    5: [
      { name: 'Network Security', code: 'CY501' },
      { name: 'Cyber Forensics', code: 'CY502' },
      { name: 'Ethical Hacking', code: 'CY503' },
      { name: 'Database Management Systems', code: 'CY504' },
      { name: 'Ethical Hacking Lab', code: 'CY505', type: 'lab', credits: 2 },
    ],
    6: [
      { name: 'Web Application Security', code: 'CY601' },
      { name: 'Malware Analysis', code: 'CY602' },
      { name: 'Security Operations & Incident Response', code: 'CY603' },
      { name: 'Cloud Security', code: 'CY604' },
      { name: 'Security Tools Lab', code: 'CY605', type: 'lab', credits: 2 },
    ],
    7: [
      { name: 'Penetration Testing', code: 'CY701' },
      { name: 'Blockchain Security', code: 'CY702', type: 'elective' },
      { name: 'IoT Security', code: 'CY703', type: 'elective' },
      { name: 'Cyber Law & Governance', code: 'CY704' },
    ],
    8: [
      { name: 'Project Work', code: 'CY801', credits: 10 },
      { name: 'Professional Ethics', code: 'HS801' },
    ],
  },
  'AI & DS': {
    3: [
      { name: 'Data Structures', code: 'AD301' },
      { name: 'Foundations of Data Science', code: 'AD302' },
      { name: 'Linear Algebra', code: 'MA302' },
      { name: 'Object Oriented Programming', code: 'AD303' },
      { name: 'Data Science Lab', code: 'AD304', type: 'lab', credits: 2 },
    ],
    4: [
      { name: 'Artificial Intelligence', code: 'AD401' },
      { name: 'Database Management Systems', code: 'AD402' },
      { name: 'Operating Systems', code: 'AD403' },
      { name: 'Probability & Statistics', code: 'MA401' },
      { name: 'AI Lab', code: 'AD404', type: 'lab', credits: 2 },
    ],
    5: [
      { name: 'Machine Learning', code: 'AD501' },
      { name: 'Data Visualization', code: 'AD502' },
      { name: 'Computer Networks', code: 'AD503' },
      { name: 'Big Data Analytics', code: 'AD504' },
      { name: 'Machine Learning Lab', code: 'AD505', type: 'lab', credits: 2 },
    ],
    6: [
      { name: 'Deep Learning', code: 'AD601' },
      { name: 'Natural Language Processing', code: 'AD602' },
      { name: 'Computer Vision', code: 'AD603' },
      { name: 'Cloud Computing', code: 'AD604' },
    ],
    7: [
      { name: 'Reinforcement Learning', code: 'AD701', type: 'elective' },
      { name: 'Generative AI', code: 'AD702', type: 'elective' },
      { name: 'MLOps', code: 'AD703' },
    ],
    8: [
      { name: 'Project Work', code: 'AD801', credits: 10 },
      { name: 'Professional Ethics', code: 'HS801' },
    ],
  },
  ECE: {
    3: [
      { name: 'Electronic Devices', code: 'EC301' },
      { name: 'Circuit Analysis', code: 'EC302' },
      { name: 'Signals & Systems', code: 'EC303' },
      { name: 'Transforms & Complex Variables', code: 'MA303' },
      { name: 'Electronic Devices Lab', code: 'EC304', type: 'lab', credits: 2 },
    ],
    4: [
      { name: 'Analog Circuits', code: 'EC401' },
      { name: 'Digital Electronics', code: 'EC402' },
      { name: 'Electromagnetic Fields', code: 'EC403' },
      { name: 'Probability & Random Processes', code: 'MA402' },
      { name: 'Digital Electronics Lab', code: 'EC404', type: 'lab', credits: 2 },
    ],
    5: [
      { name: 'Communication Systems', code: 'EC501' },
      { name: 'Microprocessors & Microcontrollers', code: 'EC502' },
      { name: 'Digital Signal Processing', code: 'EC503' },
      { name: 'Linear Integrated Circuits', code: 'EC504' },
      { name: 'Microcontrollers Lab', code: 'EC505', type: 'lab', credits: 2 },
    ],
    6: [
      { name: 'VLSI Design', code: 'EC601' },
      { name: 'Antennas & Wave Propagation', code: 'EC602' },
      { name: 'Embedded Systems', code: 'EC603' },
      { name: 'Wireless Communication', code: 'EC604' },
    ],
    7: [
      { name: 'Optical Communication', code: 'EC701' },
      { name: 'Internet of Things', code: 'EC702', type: 'elective' },
      { name: 'Satellite Communication', code: 'EC703', type: 'elective' },
    ],
    8: [
      { name: 'Project Work', code: 'EC801', credits: 10 },
      { name: 'Professional Ethics', code: 'HS801' },
    ],
  },
  VLSI: {
    3: [
      { name: 'Electronic Devices & Circuits', code: 'VL301' },
      { name: 'Digital Logic Design', code: 'VL302' },
      { name: 'Network Theory', code: 'VL303' },
      { name: 'Transforms & Complex Variables', code: 'MA303' },
      { name: 'Electronic Devices Lab', code: 'VL304', type: 'lab', credits: 2 },
    ],
    4: [
      { name: 'Analog Circuit Design', code: 'VL401' },
      { name: 'Digital System Design', code: 'VL402' },
      { name: 'Semiconductor Devices', code: 'VL403' },
      { name: 'Probability & Random Processes', code: 'MA402' },
      { name: 'Digital Design Lab', code: 'VL404', type: 'lab', credits: 2 },
    ],
    5: [
      { name: 'VLSI Design', code: 'VL501' },
      { name: 'CMOS Circuit Design', code: 'VL502' },
      { name: 'Microprocessors & Microcontrollers', code: 'VL503' },
      { name: 'Digital Signal Processing', code: 'VL504' },
      { name: 'VLSI Design Lab', code: 'VL505', type: 'lab', credits: 2 },
    ],
    6: [
      { name: 'ASIC Design', code: 'VL601' },
      { name: 'Physical Design & Verification', code: 'VL602' },
      { name: 'Embedded Systems', code: 'VL603' },
      { name: 'FPGA Design', code: 'VL604' },
    ],
    7: [
      { name: 'Low Power VLSI Design', code: 'VL701' },
      { name: 'Analog & Mixed Signal Design', code: 'VL702', type: 'elective' },
      { name: 'System on Chip Design', code: 'VL703', type: 'elective' },
    ],
    8: [
      { name: 'Project Work', code: 'VL801', credits: 10 },
      { name: 'Professional Ethics', code: 'HS801' },
    ],
  },
  Robotics: {
    3: [
      { name: 'Engineering Mechanics', code: 'RO301' },
      { name: 'Electronic Devices & Circuits', code: 'RO302' },
      { name: 'Data Structures', code: 'RO303' },
      { name: 'Transforms & Complex Variables', code: 'MA303' },
      { name: 'Electronics Lab', code: 'RO304', type: 'lab', credits: 2 },
    ],
    4: [
      { name: 'Sensors & Actuators', code: 'RO401' },
      { name: 'Microprocessors & Microcontrollers', code: 'RO402' },
      { name: 'Kinematics & Dynamics of Machines', code: 'RO403' },
      { name: 'Numerical Methods', code: 'MA403' },
      { name: 'Microcontrollers Lab', code: 'RO404', type: 'lab', credits: 2 },
    ],
    5: [
      { name: 'Robot Kinematics & Control', code: 'RO501' },
      { name: 'Control Systems', code: 'RO502' },
      { name: 'Machine Vision', code: 'RO503' },
      { name: 'Embedded Systems', code: 'RO504' },
      { name: 'Robotics Lab', code: 'RO505', type: 'lab', credits: 2 },
    ],
    6: [
      { name: 'Artificial Intelligence for Robotics', code: 'RO601' },
      { name: 'Industrial Automation', code: 'RO602' },
      { name: 'Mechatronics', code: 'RO603' },
      { name: 'Robot Operating Systems', code: 'RO604' },
    ],
    7: [
      { name: 'Autonomous Mobile Robots', code: 'RO701' },
      { name: 'Human-Robot Interaction', code: 'RO702', type: 'elective' },
      { name: 'Swarm Robotics', code: 'RO703', type: 'elective' },
    ],
    8: [
      { name: 'Project Work', code: 'RO801', credits: 10 },
      { name: 'Professional Ethics', code: 'HS801' },
    ],
  },
  Agri: {
    3: [
      { name: 'Fundamentals of Soil Science', code: 'AG301' },
      { name: 'Agricultural Statistics', code: 'MA303' },
      { name: 'Crop Production Technology', code: 'AG302' },
      { name: 'Farm Machinery & Power', code: 'AG303' },
      { name: 'Soil Science Lab', code: 'AG304', type: 'lab', credits: 2 },
    ],
    4: [
      { name: 'Agricultural Engineering', code: 'AG401' },
      { name: 'Plant Pathology', code: 'AG402' },
      { name: 'Irrigation & Water Management', code: 'AG403' },
      { name: 'Numerical Methods', code: 'MA403' },
      { name: 'Farm Machinery Lab', code: 'AG404', type: 'lab', credits: 2 },
    ],
    5: [
      { name: 'Agricultural Biotechnology', code: 'AG501' },
      { name: 'Food Science & Processing', code: 'AG502' },
      { name: 'Precision Farming', code: 'AG503' },
      { name: 'Agricultural Economics', code: 'AG504' },
      { name: 'Food Processing Lab', code: 'AG505', type: 'lab', credits: 2 },
    ],
    6: [
      { name: 'Farm Management', code: 'AG601' },
      { name: 'Post-Harvest Technology', code: 'AG602' },
      { name: 'Agricultural Marketing', code: 'AG603' },
      { name: 'Remote Sensing & GIS in Agriculture', code: 'AG604' },
    ],
    7: [
      { name: 'Precision & Smart Agriculture', code: 'AG701', type: 'elective' },
      { name: 'Organic Farming', code: 'AG702', type: 'elective' },
      { name: 'Agribusiness Management', code: 'AG703' },
    ],
    8: [
      { name: 'Project Work', code: 'AG801', credits: 10 },
      { name: 'Professional Ethics', code: 'HS801' },
    ],
  },
  'Bio Medical': {
    3: [
      { name: 'Human Anatomy & Physiology', code: 'BM301' },
      { name: 'Electronic Devices & Circuits', code: 'BM302' },
      { name: 'Biomedical Instrumentation', code: 'BM303' },
      { name: 'Transforms & Complex Variables', code: 'MA303' },
      { name: 'Electronics Lab', code: 'BM304', type: 'lab', credits: 2 },
    ],
    4: [
      { name: 'Medical Imaging Systems', code: 'BM401' },
      { name: 'Biomaterials', code: 'BM402' },
      { name: 'Biosignal Processing', code: 'BM403' },
      { name: 'Probability & Random Processes', code: 'MA402' },
      { name: 'Instrumentation Lab', code: 'BM404', type: 'lab', credits: 2 },
    ],
    5: [
      { name: 'Medical Diagnostic Equipment', code: 'BM501' },
      { name: 'Biomechanics', code: 'BM502' },
      { name: 'Hospital Management Systems', code: 'BM503' },
      { name: 'Microprocessors & Microcontrollers', code: 'BM504' },
      { name: 'Medical Imaging Lab', code: 'BM505', type: 'lab', credits: 2 },
    ],
    6: [
      { name: 'Biomedical Signal Analysis', code: 'BM601' },
      { name: 'Rehabilitation Engineering', code: 'BM602' },
      { name: 'Telemedicine', code: 'BM603' },
      { name: 'Regulatory Affairs in Medical Devices', code: 'BM604' },
    ],
    7: [
      { name: 'Artificial Organs', code: 'BM701', type: 'elective' },
      { name: 'Medical Robotics', code: 'BM702', type: 'elective' },
      { name: 'Clinical Engineering', code: 'BM703' },
    ],
    8: [
      { name: 'Project Work', code: 'BM801', credits: 10 },
      { name: 'Professional Ethics', code: 'HS801' },
    ],
  },
};

const yearOf = (semester) => Math.ceil(semester / 2);

/** Flat list: one block per department + semester, as consumed by syncSubjects. */
export const timetableSubjects = DEPARTMENTS.flatMap((department) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((semester) => ({
    department,
    year: yearOf(semester),
    semester,
    subjects: semester <= 2 ? FIRST_YEAR[semester] : BY_DEPARTMENT[department]?.[semester] || [],
  }))
);
