// ================== SETTINGS ==================
// Paste your Cloudflare Worker URL here (you get it after deploying the Worker)
const WORKER_URL = "https://shadow-ai.k-10864.workers.dev";

// false = use your data.js answers first, AI only when nothing is found (cheaper)
// true  = always use AI, with your data.js answer given to it as notes
const ALWAYS_USE_AI = false;

// ================== PLAN / LIMIT ==================
const FREE_LIMIT = 15; // must match the number in the Worker

function getUid() {
  let id = localStorage.getItem("shadow_uid");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("shadow_uid", id);
  }
  return id;
}

function getCode() {
  return localStorage.getItem("shadow_code") || "";
}

let lastPhotos = "";

function showUsage(r) {
  const el = document.getElementById("usage");
  if (!el || !r || r.left === undefined) return;
  if (r.imgMax !== undefined) {
    lastPhotos = " · 📷 " + r.imgLeft + "/" + r.imgMax + " photos left";
  }
  el.innerText =
    (r.premium
      ? "⭐ Premium: unlimited messages"
      : "Free plan: " + r.left + "/" + FREE_LIMIT + " AI messages left today") + lastPhotos;
}

function getContext() {
  const s = document.getElementById("subject");
  const g = document.getElementById("grade");
  return { subject: s ? s.value : "", grade: g ? g.value : "" };
}

async function callWorker(payload) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: getUid(), code: getCode(), ...getContext(), ...payload }),
  });
  return res.json();
}

// ================== STATE ==================
let mode = "normal";
let lastQuestion = "";
let examQuestions = [];

// ================== CHAT HELPERS ==================
function addMessage(text, type) {
  const chatBox = document.getElementById("chat-box");
  const msg = document.createElement("div");
  msg.classList.add("message", type);
  msg.innerText = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

function typeMessage(text) {
  const chatBox = document.getElementById("chat-box");
  const botMsg = document.createElement("div");
  botMsg.classList.add("message", "bot");
  chatBox.appendChild(botMsg);

  let i = 0;
  function typing() {
    if (i < text.length) {
           botMsg.innerText += text.slice(i, i + 4);
      i += 4;
      setTimeout(typing, 8);
    }
    chatBox.scrollTop = chatBox.scrollHeight;
  }
  typing();
}

// ================== MODES ==================
function setMode(m) {
  mode = m;
  for (const name of ["normal", "exam", "check"]) {
    document.getElementById("btn-" + name).classList.toggle("active", name === m);
  }

  if (m === "exam") {
    typeMessage(chapterHelp());
  } else if (m === "check") {
    typeMessage(
      "📊 Check Mode: type your answer.\n" +
        "To answer a numbered exam question, start with its number, like: 2. my answer\n" +
        (lastQuestion ? "\nCurrent question: " + lastQuestion : "")
    );
  } else {
    typeMessage("💬 Normal Mode: ask anything.");
  }
}

// ================== YOUR DATA SEARCH ==================
function searchData(input) {
  input = input.toLowerCase().trim();
  for (const item of data) {
    for (const keyword of item.keywords) {
      if (input.includes(keyword.toLowerCase())) {
        return item.answer;
      }
    }
  }
  return null;
}

function searchKing(input) {
  input = input.toLowerCase().trim();
  for (const key in kingData) {
    if (input.includes(key)) {
      const k = kingData[key];
      return `👑 ${k.name}
📅 Rise: ${k.rise}
📉 Fall: ${k.fall}

📖 ${k.details}`;
    }
  }
  return null;
}

function searchTimeline(input) {
  input = input.toLowerCase().trim();
  for (const key in timelineData) {
    if (input.includes(key)) {
      const events = timelineData[key];
      return `🕰️ ${key}:\n\n- ` + events.join("\n- ");
    }
  }
  return null;
}

// ================== MATH (safer) ==================
// Only runs if the text contains nothing but numbers, x and math symbols
function looksLikeMath(text) {
  return /^[0-9x+\-*/().^=\s]+$/i.test(text) && /[+\-*/^=]/.test(text) && /\d/.test(text);
}

function solveMath(input) {
  let q = input
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/\^/g, "**")
    .replace(/(\d|\))x/g, "$1*x") // 2x -> 2*x
    .replace(/x(\d|\()/g, "x*$1") // x2 -> x*2
    .replace(/(\d)\(/g, "$1*(") //   2( -> 2*(
    .replace(/\)\(/g, ")*("); //     )( -> )*(

  try {
    if (q.includes("=")) {
      const parts = q.split("=");
      if (parts.length !== 2) return null;
      const f = new Function("x", `return (${parts[0]}) - (${parts[1]});`);
      const solutions = [];
      for (let x = -100; x <= 100; x += 0.25) {
        if (Math.abs(f(x)) < 1e-6) solutions.push(x);
      }
      return solutions.length ? "x = " + solutions.join(" or x = ") : null;
    }

    if (q.includes("x")) return null; // cannot calculate without an equation

    const r = new Function(`return (${q});`)();
    if (typeof r === "number" && isFinite(r)) {
      return String(Number(r.toFixed(6)));
    }
  } catch {}
  return null;
}

// ================== AI (via your Worker) ==================
async function askAI(aiMode, question, extra) {
  const thinking = addMessage("⏳ Thinking...", "bot");
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: aiMode,
        question: question,
        extra: extra || "",
        uid: getUid(),
        code: getCode(),
        ...getContext(),
      }),
    });
    const result = await res.json();
    thinking.remove();
    typeMessage(result.answer || "❌ No answer received.");
    showUsage(result);
    if (result.limit) openUpgrade();
    return result.limit ? "" : result.answer;
  } catch (e) {
    thinking.remove();
    typeMessage("❌ Could not reach the AI. Check the internet or try again.");
  }
}

// ================== EXAM QUESTION BANK ==================
const questionBank = {
  // Maths
  algebra: ["Solve: 2x + 3 = 7", "Solve: 3x - 5 = 10", "Factorise: x^2 + 5x + 6"],

  // Physics
  light: ["What is reflection of light?", "Define refraction", "State the laws of reflection."],
  force: ["What is force?", "Define friction", "State Newton's second law of motion."],
  motion: ["What is motion?", "Define speed", "What is the difference between distance and displacement?"],
  sound: ["What is an echo?", "Define frequency and write its unit.", "Why can sound not travel in a vacuum?"],
  electricity: ["State Ohm's law.", "What is the difference between series and parallel circuits?", "Define electric current and write its unit."],

  // Chemistry
  "acids and bases": ["What is an indicator? Give two examples.", "What happens when an acid reacts with a metal?", "What is pH? What is the pH of a neutral solution?"],
  atoms: ["Define atom and molecule.", "What are protons, neutrons and electrons?", "What is the atomic number of an element?"],
  metals: ["Write two physical properties of metals.", "What is rusting? How can it be prevented?", "What is an alloy? Give one example."],

  // Biology
  cell: ["What is a cell?", "Write two differences between plant and animal cells.", "What is the function of the nucleus?"],
  photosynthesis: ["Define photosynthesis.", "Write the equation of photosynthesis.", "Why are stomata important?"],
  digestion: ["Name the organs of the human digestive system.", "What is the role of saliva?", "Where is digested food absorbed in the body?"],

  // Computer Science
  "computer basics": ["What is the difference between hardware and software?", "Name any four input devices.", "What is the function of the CPU?"],
  internet: ["What is the difference between the Internet and the World Wide Web?", "What is a web browser? Give two examples.", "What is a URL?"],
  "binary numbers": ["Convert 10 (decimal) to binary.", "Convert 1011 (binary) to decimal.", "Why do computers use binary?"],
  python: ["What is a variable in Python?", "Write a program to print the numbers 1 to 5.", "What is the difference between a list and a tuple?"],
  html: ["What does HTML stand for?", "What is the use of the <a> tag?", "Write the tags needed for a simple web page with a heading."],

  // English
  tenses: ["Write the past tense of: go, eat, write.", "Identify the tense: 'She has finished her homework.'", "Change to future tense: 'I play cricket.'"],
  "parts of speech": ["Define noun, pronoun and adjective with one example each.", "Identify the verb: 'The dog barked loudly.'", "What is an adverb? Give two examples."],
  "letter writing": ["What are the main parts of a formal letter?", "Write a short letter to your principal asking for leave.", "What is the difference between a formal and an informal letter?"],
  "essay writing": ["Write the steps to plan an essay.", "Write a short paragraph on 'My School'.", "What is the difference between a paragraph and an essay?"],

  // Hindi (type the chapter name in English letters)
  sangya: ["संज्ञा किसे कहते हैं? इसके भेद लिखिए।", "व्यक्तिवाचक संज्ञा के दो उदाहरण दीजिए।", "इनमें से संज्ञा छाँटिए: राम, सुंदर, दौड़ना, दिल्ली।"],
  sarvanam: ["सर्वनाम किसे कहते हैं? दो उदाहरण दीजिए।", "सर्वनाम के भेद लिखिए।", "रिक्त स्थान भरिए: ___ विद्यालय जा रहा है। (वह / वे)"],
  "patra lekhan": ["औपचारिक पत्र के मुख्य भाग कौन-कौन से होते हैं?", "प्रधानाचार्य को अवकाश के लिए प्रार्थना पत्र लिखिए।", "औपचारिक और अनौपचारिक पत्र में क्या अंतर है?"],

  // Cricket
  "cricket rules": ["What is LBW?", "How many players are in a team, and how many overs are bowled in a T20 innings?", "What is a no-ball and what happens after it?"],
  "cricket formats": ["Name the three international formats of cricket.", "What is the difference between a Test match and an ODI?", "What is the DLS method used for?"],
  "cricket basics": ["Name any five fielding positions.", "What is the difference between a bowled and a caught dismissal?", "What does a wicketkeeper do?"],
};

const chapterGroups = {
  Maths: ["algebra"],
  Physics: ["light", "force", "motion", "sound", "electricity"],
  Chemistry: ["acids and bases", "atoms", "metals"],
  Biology: ["cell", "photosynthesis", "digestion"],
  "Computer Science": ["computer basics", "internet", "binary numbers", "python", "html"],
  English: ["tenses", "parts of speech", "letter writing", "essay writing"],
  Hindi: ["sangya", "sarvanam", "patra lekhan"],
  Cricket: ["cricket rules", "cricket formats", "cricket basics"],
};

function chapterHelp() {
  let out = "📘 Exam Mode: type a chapter name from this list.\nAny other chapter works too, and the AI will make the questions.\n";
  for (const group in chapterGroups) {
    out += "\n" + group + ": " + chapterGroups[group].join(", ");
  }
  return out;
}

async function generateQuestions(chapter) {
  let questions = questionBank[chapter];

  // not in the list: let the AI make the questions
  if (!questions) {
    const s = getContext().subject;
    const text = await askAI(
      "answer",
      "Write 5 short exam questions (questions only, no answers, numbered 1 to 5) on the chapter: " +
        chapter +
        "." +
        (s ? " Subject: " + s + "." : ""),
      ""
    );
    if (!text) return;
    examQuestions = text
      .split("\n")
      .map((l) => l.match(/^\s*\d+[.)]\s*(.+)/))
      .filter(Boolean)
      .map((m) => m[1].trim());
    lastQuestion = examQuestions[0] || "";
    return;
  }

  examQuestions = questions;
  lastQuestion = questions[0];

  let output = "📘 Questions:\n\n";
  questions.forEach((q, i) => {
    output += i + 1 + ". " + q + "\n";
  });
  output += "\nNow switch to Check Answer and type your answer, like: 1. my answer";
  typeMessage(output);
}

// ================== MAIN FUNCTION ==================
async function getAnswer() {
  const inputBox = document.getElementById("question");
  const q = inputBox.value.trim();
  if (!q) return;
  inputBox.value = "";

  addMessage(q, "user");

  // 📘 EXAM MODE: the typed text is the chapter name
  if (mode === "exam") {
    generateQuestions(q.toLowerCase());
    return;
  }

  // 📊 CHECK MODE: AI checks the student's answer
  if (mode === "check") {
    let question = lastQuestion;
    let answer = q;

    const m = q.match(/^(\d+)[.):\s]\s*([\s\S]*)$/);
    if (m && examQuestions[Number(m[1]) - 1]) {
      question = examQuestions[Number(m[1]) - 1];
      answer = m[2];
    }

    if (!question) {
      typeMessage("First ask a question in Normal Mode or get questions from Exam Mode.");
      return;
    }
    await askAI("check", question, answer);
    return;
  }

  // 💬 NORMAL MODE
  lastQuestion = q;

  const notes = searchKing(q) || searchTimeline(q) || searchData(q);

  if (notes && !ALWAYS_USE_AI) {
    typeMessage(notes);
    return;
  }

  if (!notes && looksLikeMath(q)) {
    const result = solveMath(q);
    if (result) {
      typeMessage("Answer: " + result);
      return;
    }
  }

  await askAI("answer", q, notes || "");
}

// ================== VOICE ==================
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("Voice input is not supported in this browser. Try Chrome.");
    return;
  }
  const rec = new SR();
  rec.lang = "en-IN";
  rec.onresult = (e) => {
    document.getElementById("question").value = e.results[0][0].transcript;
    getAnswer();
  };
  rec.onerror = () => typeMessage("❌ Could not hear you. Try again.");
  rec.start();
}

// ================== PHOTO QUESTIONS ==================
function pickPhoto() {
  document.getElementById("photo").click();
}

// shrink the photo (max 1280px, JPEG) so it uploads fast
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject();
    };
    img.src = url;
  });
}

async function handlePhoto(input) {
  const file = input.files[0];
  input.value = "";
  if (!file) return;

  const inputBox = document.getElementById("question");
  const q = inputBox.value.trim();
  inputBox.value = "";

  let dataUrl;
  try {
    dataUrl = await shrinkImage(file);
  } catch (e) {
    typeMessage("❌ Could not read that photo. Try another one.");
    return;
  }

  // show the photo in the chat
  const chatBox = document.getElementById("chat-box");
  const msg = addMessage(q || "📷 Photo question", "user");
  const pic = document.createElement("img");
  pic.src = dataUrl;
  pic.style.cssText = "display:block;max-width:100%;border-radius:8px;margin-top:6px;";
  msg.appendChild(pic);
  chatBox.scrollTop = chatBox.scrollHeight;

  const thinking = addMessage("⏳ Reading your photo...", "bot");
  try {
    const result = await callWorker({ mode: "image", image: dataUrl.split(",")[1], question: q });
    thinking.remove();
    typeMessage(result.answer || "❌ No answer received.");
    showUsage(result);
    if (result.limit) openUpgrade();
  } catch (e) {
    thinking.remove();
    typeMessage("❌ Could not reach the AI. Try again.");
  }
}

// ================== UPGRADE ==================
function openUpgrade() {
  document.getElementById("upgrade").style.display = "flex";
}

function closeUpgrade() {
  document.getElementById("upgrade").style.display = "none";
}

async function redeemCode() {
  const msg = document.getElementById("code-msg");
  const code = document.getElementById("code-input").value.trim().toUpperCase();
  if (!code) return;
  msg.innerText = "Checking...";
  try {
    const r = await callWorker({ mode: "redeem", code: code });
    if (r.ok) {
      localStorage.setItem("shadow_code", code);
      msg.innerText = "✅ Premium unlocked!";
      callWorker({ mode: "status" }).then(showUsage).catch(() => {});
      setTimeout(closeUpgrade, 1200);
    } else {
      msg.innerText = "❌ " + (r.answer || "Invalid code.");
    }
  } catch (e) {
    msg.innerText = "❌ Could not reach the server.";
  }
}

// show how many messages are left when the page opens
callWorker({ mode: "status" }).then(showUsage).catch(() => {});

// ================== ENTER KEY ==================
document.getElementById("question").addEventListener("keydown", (e) => {
  if (e.key === "Enter") getAnswer();
});
