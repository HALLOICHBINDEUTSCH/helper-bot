// ================== SETTINGS ==================
// Paste your Cloudflare Worker URL here (you get it after deploying the Worker)
   const WORKER_URL = "https://shadow-ai.k-10864.workers.dev";

// false = use your data.js answers first, AI only when nothing is found (cheaper)
// true  = always use AI, with your data.js answer given to it as notes
const ALWAYS_USE_AI = false;

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
      botMsg.innerText += text[i];
      i++;
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
    typeMessage(
      "📘 Exam Mode: type a chapter name.\nAvailable: " +
        Object.keys(questionBank).join(", ")
    );
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
      body: JSON.stringify({ mode: aiMode, question: question, extra: extra || "" }),
    });
    const result = await res.json();
    thinking.remove();
    typeMessage(result.answer || "❌ No answer received.");
  } catch (e) {
    thinking.remove();
    typeMessage("❌ Could not reach the AI. Check the internet or try again.");
  }
}

// ================== EXAM QUESTION BANK ==================
const questionBank = {
  light: ["What is reflection of light?", "Define refraction"],
  force: ["What is force?", "Define friction"],
  motion: ["What is motion?", "Define speed"],
  algebra: ["Solve: 2x + 3 = 7"],
};

function generateQuestions(chapter) {
  const questions = questionBank[chapter];
  if (!questions) {
    typeMessage("❌ Chapter not found. Available: " + Object.keys(questionBank).join(", "));
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

// ================== ENTER KEY ==================
document.getElementById("question").addEventListener("keydown", (e) => {
  if (e.key === "Enter") getAnswer();
});
