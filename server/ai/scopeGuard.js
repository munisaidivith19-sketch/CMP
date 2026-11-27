/**
 * Strict scope guard for the AI Doubts assistant (self-hosted model).
 *
 * Runs on every question BEFORE retrieval or the local model is called. The assistant may only answer doubts about study
 * materials, academic concepts and subjects. Anything that asks for people's
 * details, other platform features, or tries to unlock the model is refused
 * with a fixed message — the model never even sees it.
 *
 * This is one layer of several; the hard guarantee is structural: the model
 * has no tools and no database access, and the only data it is ever given is
 * study-material text the student is already allowed to read
 * (src/services/ai/sources/studyMaterialSource.js → materialReadFilter).
 */

/**
 * Fixed replies. Like ChatGPT / Claude, refusals are short, polite, never
 * preachy, and point to what the student CAN ask. Some categories are not
 * refusals at all: greetings / thanks / "what can you do" get a friendly
 * reply, and a student in distress gets support and a helpline.
 */
export const REFUSALS = {
  personal_data:
    "I can't help with that — I don't have access to any student, staff or personal details, and I can't share anyone's contact information. I'm here for your studies: ask me about any subject, concept or your study materials.",
  platform_feature:
    "I don't have access to attendance, marks, timetables, fees, gate passes, complaints or accounts — please use that section of the app. I'm happy to help with any study doubt though!",
  prompt_attack:
    "I can't do that — my rules stay the same whatever a message says. Ask me any study question and I'll help.",
  off_topic:
    "That's outside what I can help with here — I'm focused on your studies. 😊 Ask me about any subject, concept or your study materials!",
  sexual:
    "I can't help with that. If it's for a biology topic (like reproduction, hormones or genetics), ask it as a study question and I'll explain it in textbook terms.",
  system_probe:
    "I can't share anything about how this platform, its servers or its data are built or secured. I'm happy to explain general computer-science topics (like how databases or servers work) as study questions.",
  harmful:
    "I can't help with that because it could cause real harm to people. If you're studying this topic, I can explain the underlying science, or the safety, legal and ethical side instead.",
  // ── Not refusals ──
  self_harm:
    "I'm really sorry you're feeling this way. You don't have to go through it alone — please talk to someone right now.\n\n- **Tele-MANAS (free, 24×7, Govt. of India):** call **14416** or **1-800-891-4416**\n- **Emergency:** call **112**\n- Talk to someone you trust — a friend, family member, your class in-charge or the college counsellor.\n\nIf you're in immediate danger, please call 112 or go to the nearest hospital. I'm here for your studies whenever you're ready, but right now your safety matters most. 💙",
  identity:
    "I'm JNN's AI Doubts assistant, made to help JNN students clear their study doubts. I can't share technical details about how I'm built or run — but ask me about any subject or your study materials and I'll help!",
  greeting:
    "Hi! 👋 I'm JNN's AI Doubts assistant. Ask me anything about your subjects, concepts or study materials — you can also attach a file with 📎 and ask about a specific unit or question.",
  thanks: "You're welcome! 😊 Ask me anytime you have another doubt.",
  bye: 'All the best with your studies! 👋 Come back anytime you have a doubt.',
  capabilities:
    "Here's what I can do:\n\n- **Explain concepts** step by step, with examples\n- **Solve problems** and show the working\n- **Your study materials:** attach a file with 📎 and ask about a unit or question (e.g. *Unit 1 Part B Q1*)\n- **Exam prep:** key points, short notes, likely questions\n- **Other languages:** ask me to explain in Telugu, Hindi and more\n\nI give a short answer first — tap **Explain in detail** for more. I can't access attendance, marks, accounts or anyone's personal details.",
};

/** Categories answered with a friendly / supportive message instead of a refusal. */
export const NOT_REFUSAL = new Set(['self_harm', 'identity', 'greeting', 'thanks', 'bye', 'capabilities']);

/** Categories that count as a misuse strike (see strikes.js). */
export const STRIKE_CATEGORIES = new Set(['prompt_attack', 'system_probe', 'sexual']);

// Personal / people data — about anyone, including the asker's classmates.
// Every pattern needs a "person" anchor so CS questions ("address of a
// variable", "parent of a node", "password hashing for security") still pass.
const WHO = String.raw`(student|students|classmates?|friend|faculty|teachers?|lecturer|professor|staff|hod|principal|warden|parent|user|someone|him|her|them|roll\s*(no\.?|number)\s*\w+)`;
const PERSONAL = [
  /\b(phone|mobile|contact|whatsapp)\s*(no\.?|number|num|details?)\s*(of|for)\b/i,
  /\b(email|e-mail)\s*(id|address)?\s*(of|for)\s+(my|the|a|this|that|our)?\s*\w+/i,
  /\b(home address|residential address|date of birth|dob|aadhaar|aadhar|pan card|blood group)\s+(of|for)\b/i,
  /\b(parent'?s?|father'?s?|mother'?s?|guardian'?s?)\s+(name|number|phone|details?|occupation)\b/i,
  /\b(roll|register|registration|admission|hall ticket)\s*(no\.?|number|num)\s*(of|for)\b/i,
  /\b(list|show|give|tell|find|get|search)\b.{0,40}\b(students?|classmates?|faculty|teachers?|staff|users?|hod|wardens?|parents?)\b.{0,40}\b(details?|names?|list|data|records?|profiles?|info(rmation)?|numbers?|emails?)\b/i,
  new RegExp(String.raw`\b(details?|profile|personal (info|information|data)|records?)\s+(of|about)\s+(a |the |my |this |that )?${WHO}\b`, 'i'),
  /\bwho\s+(is|are|was|were)\s+(the\s+)?(topper|toppers|absent|present today|in my class|my classmates?)\b/i,
  /\bhow\s+(can|do|should|could)\s+(i|we)\s+(contact|reach|call|email|e-mail|message|text|find)\s+(him|her|them|the (author|lecturer|faculty|teacher|professor|staff|hod)|my (lecturer|faculty|teacher|professor|hod|classmate|friend))\b/i,
  /\b(contact|whatsapp|personal)\s+(details?|info(rmation)?)\b/i,
  new RegExp(String.raw`\b(password|otp|login credentials?|session token)s?\s+(of|for)\s+(the |my |a |this )?(${WHO}|admin|account)\b`, 'i'),
];

// Other platform features the assistant must not touch or report on.
const FEATURES = [
  /\b(my|his|her|their|our|class|student'?s?)\s+attendance\b/i,
  /\battendance\s+(of|for|percentage|report|status|record|shortage)\b/i,
  /\b(absentees?|who (is|was) absent|leave (status|request|balance))\b/i,
  /\b(my|his|her|their|student'?s?|internal|external|semester|mid|exam)\s+(marks?|grades?|scores?|results?|cgpa|sgpa|gpa|rank)\b/i,
  /\b(marks?|grades?|results?|cgpa|sgpa)\s+(of|for)\s+(me|my|the student|student|roll|him|her|them)\b/i,
  /\b(my|our|class|today'?s?|tomorrow'?s?)\s+(timetable|time table|schedule|periods)\b/i,
  /\b(bus (route|timings?)|hostel (room|fees?|allotment|warden)|mess menu)\b/i,
  /\b(my|pending|due|college|semester|hostel|tuition)\s+fees?\b|\bfee (due|receipt|payment|structure of (jnn|this college))\b/i,
  /\b(gate ?pass|outpass|out pass|skill wallet|alumni (list|directory)|placement (list|status))\b/i,
  /\b(my|file|raise|register|submit|lodge|status of)\s+(a\s+|my\s+)?(complaints?|grievances?)\b/i,
  /\b(change|update|edit|mark|delete|reset|approve|reject|increase|fix)\s+(my|his|her|their|our|the student'?s?|a student'?s?|someone'?s?)\s+.{0,20}\b(attendance|marks?|grades?|role|account|password|profile|record|gate ?pass|complaint)\b/i,
  /\b(this|your|the college'?s?|jnn'?s?|the app'?s?|this app'?s?|platform'?s?|campus ?connect'?s?)\s+(database|db|server|backend|admin panel|users?)\b/i,
];

// Attempts to unlock, re-role or extract the model's instructions/secrets.
// Generic concept questions ("what is a system prompt?", "what is an API
// key?") are allowed — only requests aimed at THIS assistant are blocked.
const ATTACKS = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|your|system)\b.{0,20}\b(instructions?|rules?|prompts?|guidelines?|restrictions?)\b/i,
  /\b(reveal|show|print|repeat|leak|tell me|output|display|give( me)?|share)\b.{0,30}\b(your|its|the hidden|this bot'?s?|this assistant'?s?)\s+(system\s+)?(prompt|instructions|rules|guidelines|configuration|config)\b/i,
  /\b(reveal|show|print|leak|give( me)?|share|send|tell me)\b.{0,30}\b(your|the|groq|server'?s?|backend|app'?s?|this)\b.{0,15}\b(api[\s_-]?key|secret key|access token|env(ironment)? variables?|\.env)\b/i,
  /\bgroq\b.{0,15}\b(key|token|secret)\b/i,
  /\b(everything|what|anything)\s+(you\s+)?(were|have been|'ve been|was)\s+(told|instructed|given|programmed)\b/i,
  /\b(rules|guidelines|instructions|policies|restrictions)\s+(that\s+)?you\s+(follow|obey|were given|have been given|have|use)\b/i,
  /\b(jailbreak|dan mode|god mode|no restrictions|unrestricted mode|without (any )?restrictions|act as (an? )?(admin|administrator|root|hacker))\b/i,
  /\b(pretend|role-?play|imagine)\b.{0,30}\b(you are|you're)\b.{0,30}\b(not|no longer|without|free)\b/i,
];

// Clearly non-academic requests. Kept narrow on purpose so real study
// questions (e.g. "economics of films", "physics of music") still pass.
const OFF_TOPIC = [
  /^\s*(tell|say|write)\s+(me\s+)?(a\s+)?(joke|pickup line|roast|love letter|shayari)\b/i,
  /\b(girlfriend|boyfriend|crush|dating|flirt|relationship advice)\b/i,
  /\b(movie|film|web ?series|song|tv show|ott)\s+(recommendations?|suggestions?|to watch|review)\b/i,
  /\b(cricket|ipl|football|match)\s+(score|result|prediction|today)\b/i,
  /\b(horoscope|astrology|lottery|betting|gambling)\b/i,
];

// ── Prompt-injection families (beyond the classic overrides above) ──────
// Fake chat-template / role markers ("sockpuppeting", chat-template injection).
const ROLE_MARKERS = [
  /<\|?\s*(im_start|im_end|system|endoftext|eot_id|start_header_id|end_header_id|begin_of_text)\s*\|?>/i,
  /\[\/?\s*(INST|SYS)\s*\]|<<\s*\/?\s*SYS\s*>>/i,
  /<\/?\s*(tool_call|tool_response|function_call|system_prompt|developer|assistant)\b[^>]*>/i,
  /^\s*#{0,4}\s*(system|developer|assistant)\s*(prompt|message|instructions?)?\s*:/im,
  /"role"\s*:\s*"(system|developer|assistant|tool)"/i,
];
// Policy Puppetry: the request dressed up as a configuration / policy file.
const POLICY_PUPPETRY = [
  /<\s*(interaction-config|policy|config|configuration|rules|guardrails?|blocked-?(strings|modes)|allowed-?(responses|modes))\b[^>]*>/i,
  /^\s*\[\s*(system|config|configuration|policy|rules|settings|admin)\s*\]\s*$/im,
  /\b(allowed|blocked)[ _-]?(modes|responses|strings)\s*[:=]/i,
  /\b(safety|content)[ _-]?(filter|policy|guardrails?)\s*[:=]\s*(off|false|0|disabled|none)\b/i,
];
// Obfuscation used as an attack instruction ("decode this and do it").
const DECODE_AND_FOLLOW = /\b(decode|decrypt|translate|reverse|unscramble|rot13|base64|hex)\b.{0,60}\b(follow|obey|execute|run|do what it says|carry out|act on|answer it)\b/i;
// Emotional pressure aimed at secrets / the system ("grandma" exploit).
const EMOTIONAL_SECRETS = /\b(grandma|grandmother|granny|dead|dying|deceased|late (mother|father)|i('?m| am) (crying|begging|desperate)|my life depends|i will (fail|die|be expelled))\b.{0,80}\b(password|passwords|key|keys|secret|token|credentials|database|server|prompt|instructions|rules|admin)\b/i;

// ── Sexual content ───────────────────────────────────────────────────
// Bare "sex"/"sexual" is NOT blocked, so syllabus biology still works
// ("sexual reproduction in plants", "sex chromosomes", "sex-linked traits").
const SEXUAL = [
  /\b(porn\w*|pornograph\w*|nsfw|xxx|erotic\w*|hentai|onlyfans|sexting|sext|nudes?|naked (pic|photo|picture|image|video|girl|boy|women|men)s?|blowjob|handjob|masturbat\w*|orgasm\w*|fetish\w*|bdsm|kinky|horny|hook ?up|one night stand|strip ?club|escort service)\b/i,
  /\b(have|having|had|want|wanna)\s+sex\b|\bsex\s+(with|chat|story|stories|video|videos|position|positions|scene|tips|life|toys?|talk|game)\b/i,
  /\b(sexual|sexy|dirty|steamy|romantic|intimate|spicy)\s+(story|stories|fantasy|fantasies|roleplay|role-play|chat|scene|poem|messages?|talk|pics?|photos?)\b/i,
  /\b(seduce|seduction|make love|making love|turn me on|flirt with me|kiss me|be my (girlfriend|boyfriend|lover))\b/i,
  /\b(rape|molest\w*|incest)\s+(story|scene|fantasy|roleplay|role-play)\b/i,
  /\b(child|children|minor|minors|kid|kids|underage|teen|teens|schoolgirl|schoolboy)\b.{0,40}\b(sex|sexual|nude|naked|porn|erotic)\b|\b(sex|sexual|nude|naked|porn|erotic)\b.{0,40}\b(child|children|minor|minors|kid|kids|underage|schoolgirl|schoolboy)\b/i,
];

// ── This platform's servers, data and technology ─────────────────────
// General computing questions stay allowed ("What is MongoDB?", "How does
// SQL injection work?"). Only questions aimed at THIS platform are refused.
const OUR = String.raw`(this|your|our|ur|jnn'?s?|the college'?s?|college|campus ?connect'?s?|the (app|website|site|portal|platform)'?s?)`;
const TECH = String.raw`(server|servers|database|databases|db|tech(nology)? stack|stack|framework|backend|back-end|frontend|front-end|hosting|host|hosted|cloud|ip( address)?|ports?|domain|dns|admin( panel| page| account)?|source( code)?|code ?base|api|apis|endpoints?|version|operating system|os|linux|nginx|mongo\w*|node(\.?js)?|express|react|ollama|model|llm|ai model|infrastructure|architecture|network|wifi|firewall|config\w*|env|environment variables?|security|vulnerabilit\w*|credentials?|passwords?|keys?|tokens?|logs?|backups?|users? table|collections?)`;
const SYSTEM_PROBE = [
  new RegExp(String.raw`\b${OUR}\s+(\w+\s+){0,2}${TECH}\b`, 'i'),
  new RegExp(String.raw`\b(what|which|how|where|tell me|show me|explain|list|describe)\b.{0,40}\b${TECH}\b.{0,30}\b(does|do|is|are|did)\s+((this|the|your|ur|our)\s+(college|app|website|site|portal|platform|system|erp)|this|you|u|jnn|campus ?connect)\s+(use|uses|run|runs|running|built|made|hosted|store|stores|have)\b`, 'i'),
  /\b(how|where)\s+(are|r)\s+(you|u)\s+(built|made|hosted|running|deployed|trained)\b|\b(what|which)\s+(server|machine|computer|hardware)\s+(are|r)\s+(you|u)\b/i,
  new RegExp(String.raw`\b(hack|hacking|exploit|attack|bypass|crack|ddos|dos|brute[ -]?force|sql ?inject\w*|xss|pentest|penetrat\w*|break into|get into|access)\b.{0,40}\b${OUR}\s+(\w+\s+)?(portal|website|site|app|server|system|database|db|network|wifi|platform|account|admin|erp)\b`, 'i'),
];

// ── "Who are you?" — answered politely, no technical details, no strike ──
const IDENTITY = [
  /\b(what|which)\s+(ai\s+|language\s+)?model\s+(are|r)\s+(you|u)\b|\b(who|what company)\s+(made|built|created|trained|developed)\s+(you|u)\b|\bare (you|u) (gpt|chatgpt|claude|gemini|llama|qwen|mistral|a bot|an ai|human|real)\b/i,
  /^\s*(who|what)\s+(are|r)\s+(you|u)\s*\??\s*$/i,
  /^\s*(what('?s| is) your name|introduce yourself)\s*\??\s*$/i,
];

// ── Self-harm: a caring reply with a helpline, never a refusal or a strike ──
const SELF_HARM = [
  /\b(kill|hurt|harm|cut|end)\s+my\s?self\b|\bsuicid(e|al)\b|\bself[- ]?harm(ing)?\b/i,
  /\b(i\s+)?(want|wanna|going|plan(ning)?|thinking of|feel like)\s+to\s+(die|end (it all|my life)|not (be alive|exist))\b/i,
  /\bend(ing)?\s+my\s+life\b|\bno\s+(reason|point)\s+(to|in)\s+(live|living|go on)\b|\bi\s+(don'?t|do not)\s+want\s+to\s+(live|be alive|wake up)\b|\bbetter off dead\b/i,
  /\b(chanipovali|chachipovali|chanipotha|chanipothanu|aatmahatya|atmahatya|marna chahta|marna chahti|mar jaunga|mar jaungi|khudkushi)\b/i,
];
// Studying the topic (sociology, psychology, prevention) is a normal study question.
const SELF_HARM_ACADEMIC = /\b(theory|theories|durkheim|rates?|statistics|prevention|awareness|sociology|psychology|essay|case study|literature|causes of|types of|define|definition)\b/i;
const FIRST_PERSON = /\b(i|i'm|im|me|my|myself)\b/i;

// ── Clearly harmful, operational requests (like ChatGPT / Claude usage policies) ──
// Learning HOW something works stays allowed ("how does ransomware work?",
// "explain the thermite reaction"); step-by-step harm to real people does not.
const HARMFUL = [
  /\b(how\s+(to|do\s+i|can\s+i|would\s+i)|steps?\s+to|ways?\s+to|recipe\s+for|make|build|create|assemble)\b.{0,30}\b(bomb|explosives?|ied|grenade|molotov|pipe\s*bomb|napalm|firearm|gun|pistol|silencer)\b/i,
  /\b(how\s+(to|do\s+i|can\s+i)|steps?\s+to|make|cook|synthesi[sz]e|extract|grow|buy|get)\b.{0,30}\b(meth|methamphetamine|cocaine|heroin|lsd|mdma|ecstasy|ganja|weed|marijuana|opium|fentanyl|illegal drugs?)\b/i,
  /\b(poison|kill|murder|hurt|stab|kidnap|attack|beat up)\s+(someone|somebody|a person|people|him|her|them|my\s+(friend|teacher|lecturer|classmate|roommate|father|mother|dad|mom|brother|sister|wife|husband|neighbou?r|boss|ex))\b/i,
  /\b(hack|crack|break\s+into|get\s+into|access|spy\s+on|track)\b.{0,30}\b(someone'?s?|somebody'?s?|other'?s|another\s+(person|student)'?s?|my\s+(friend|classmate|ex|girlfriend|boyfriend|teacher)'?s?|(his|her|their))\b.{0,25}\b(account|instagram|facebook|whatsapp|gmail|email|phone|mobile|wifi|password|location|chats?)\b/i,
  /\b(write|create|make|code|build|give\s+me)\b.{0,25}\b(ransomware|keylogger|virus|trojan|worm|malware|botnet|rootkit|spyware|phishing\s+(page|site|email|link)|credential\s+stealer)\b/i,
  /\b(cheat|cheating)\b.{0,25}\b(in|during|on|for)\b.{0,12}\b(exam|exams|test|quiz|assessment)\b|\b(leak(ed)?|get|buy)\s+(the\s+)?(question\s+paper|exam\s+paper|answer\s+key)\b|\bbypass\b.{0,20}\b(proctor\w*|invigilat\w*|plagiarism\s+check\w*)\b/i,
];

// ── Small talk: only when the WHOLE message is a greeting / thanks / bye / "what can you do" ──
const SMALL_TALK = [
  ['greeting', /^\s*(hi+|hii+|hello+|hey+|hai|hlo|helo|yo|namaste|namaskaram|good\s+(morning|afternoon|evening|night))\b[\s!.,]*(there|bot|ai|buddy|sir|madam|mam)?[\s!.😊🙂👋]*$/iu],
  ['thanks', /^\s*(ok(ay)?\s*,?\s*)?(thanks?|thank\s*(you|u)|thx|tq|ty|tnx|dhanyavad(alu)?|great|super|nice|cool|got\s+it|understood)\b[\s\w!.,😊🙂👍]{0,20}$/iu],
  ['bye', /^\s*(ok(ay)?\s*,?\s*)?(bye+|good\s*bye|see\s+(you|u)|tata|cya)\b[\s!.😊🙂👋]*$/iu],
  ['capabilities', /^\s*(what\s+(can|do)\s+(you|u)\s+do|how\s+(can|do)\s+(you|u)\s+help(\s+me)?|what\s+are\s+(you|u)\s+for|help|how\s+to\s+use\s+(you|this))\s*\??\s*$/i],
];

// Many-shot jailbreaks paste long fake dialogues.
const MANY_SHOT = /^\s*(user|human|student|q|question|assistant|ai|bot|a|answer|system)\s*[:：]/gim;

// Order matters: the first matching group wins.
const GROUPS = [
  ['prompt_attack', [...ATTACKS, ...ROLE_MARKERS, ...POLICY_PUPPETRY, DECODE_AND_FOLLOW, EMOTIONAL_SECRETS]],
  ['sexual', SEXUAL],
  ['harmful', HARMFUL],
  ['system_probe', SYSTEM_PROBE],
  ['identity', IDENTITY],
  ['personal_data', PERSONAL],
  ['platform_feature', FEATURES],
  ['off_topic', OFF_TOPIC],
];

// ── Normalization (defeats look-alikes, invisible chars, l33t, spacing) ──
const ZERO_WIDTH = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
const HOMOGLYPHS = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ɡ: 'g', һ: 'h', ӏ: 'l', ο: 'o', α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ρ: 'p', τ: 't', υ: 'u', χ: 'x', А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X' };
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };

export function normalizeForCheck(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(/[\u0400-\u04ff\u0370-\u03ff\u0250-\u02af\u0500-\u052f]/g, (c) => HOMOGLYPHS[c] || c);
}

/** Extra spellings of the text to check: l33t decoded, s p a c e d letters joined, base64 decoded. */
function variants(text) {
  const out = [text];
  const deleet = text.replace(/[0134578@$!|]/g, (c) => LEET[c]);
  if (deleet !== text) out.push(deleet);
  // "i g n o r e  a l l" / "i.g.n.o.r.e" → "ignore all"
  const joined = text.replace(/\b(?:[A-Za-z][\s._*-]){3,}[A-Za-z]\b/g, (m) => m.replace(/[\s._*-]/g, ''));
  if (joined !== text) out.push(joined);
  for (const m of text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) || []) {
    try {
      const decoded = Buffer.from(m, 'base64').toString('utf8');
      if (decoded.length >= 8 && /^[\x20-\x7e\s]+$/.test(decoded)) out.push(decoded);
    } catch {
      /* not base64 */
    }
  }
  return out;
}

function classify(text) {
  for (const [category, patterns] of GROUPS) {
    for (const re of patterns) {
      re.lastIndex = 0;
      if (re.test(text)) return category;
    }
  }
  MANY_SHOT.lastIndex = 0;
  if ((text.match(MANY_SHOT) || []).length >= 4) return 'prompt_attack';
  return null;
}

/**
 * @param {string} message the student's question (already trimmed)
 * @returns {{ allowed: true } | { allowed: false, category: string, reply: string, refused: boolean }}
 *   refused=false → a friendly / supportive reply (greeting, help, distress), not a refusal.
 */
const verdict = (category, extra = {}) => ({ allowed: false, category, reply: REFUSALS[category], refused: !NOT_REFUSAL.has(category), ...extra });

function isSelfHarm(text) {
  if (!SELF_HARM.some((re) => re.test(text))) return false;
  // "Durkheim's theory of suicide", "suicide prevention essay" → a study question.
  return !(SELF_HARM_ACADEMIC.test(text) && !FIRST_PERSON.test(text));
}

export function checkScope(message) {
  const base = normalizeForCheck(message);
  // Someone in distress always gets support first, whatever else the message says.
  if (isSelfHarm(base)) return verdict('self_harm');
  for (const v of variants(base)) {
    const category = classify(v);
    if (category) return verdict(category);
  }
  for (const [category, re] of SMALL_TALK) if (re.test(base)) return verdict(category);
  return { allowed: true };
}

/**
 * Multi-turn check (Crescendo / payload splitting): the current question is
 * checked alone AND joined with the student's recent questions in this chat,
 * so an attack split across messages is still caught. The joined check only
 * looks for attack / probing / sexual content, never ordinary refusals.
 */
export function checkConversation(message, recentUserMessages = []) {
  const single = checkScope(message);
  if (!single.allowed) return single;
  const recent = recentUserMessages.slice(-3);
  if (!recent.length) return single;
  for (const joiner of [' ', '']) {
    const joined = normalizeForCheck([...recent, message].join(joiner));
    for (const v of variants(joined)) {
      const category = classify(v);
      if (category && STRIKE_CATEGORIES.has(category)) return verdict(category, { multiTurn: true });
    }
  }
  return single;
}

/**
 * Output filter: whatever the model writes, contact details never leave the
 * server. (Study materials can contain a lecturer's email or phone on the
 * title page; the assistant has no reason to repeat them.)
 */
export function scrubOutput(text) {
  return (
    String(text)
      // No images or clickable links in answers: blocks data exfiltration through
      // markdown images/links. Verified sources are shown separately by the app.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\((?:https?:|ftp:|data:|javascript:)[^)]*\)/gi, '$1')
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/\b(?:https?|ftp):\/\/[^\s)<>"']+/gi, '[link removed]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[contact removed]')
      .replace(/(?<![\d.])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, '[contact removed]')
  );
}

/** Output check: does generated text contain sexual content? (syllabus biology passes) */
export function looksSexual(text) {
  const t = normalizeForCheck(text);
  return SEXUAL.some((re) => {
    re.lastIndex = 0;
    return re.test(t);
  });
}

/**
 * Indirect prompt injection: study-material text (e.g. a PDF) that contains
 * instructions aimed at the AI. Such excerpts are dropped before the model
 * sees them. Only attack patterns are checked, never ordinary topics.
 */
export function looksLikeInjection(text) {
  const base = normalizeForCheck(text);
  const attacks = GROUPS[0][1];
  return variants(base).some((v) =>
    attacks.some((re) => {
      re.lastIndex = 0;
      return re.test(v);
    })
  );
}
