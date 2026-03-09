const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// Resend helper
async function sendEmail(to, subject, html) {
  const resendKey = functions.config().resend.key;
  const fromAddr = functions.config().resend.from;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + resendKey },
    body: JSON.stringify({ from: fromAddr, to: [to], subject, html })
  });
  if (!resp.ok) { const err = await resp.text(); console.error("Resend fejl:", err); throw new Error("Email fejl"); }
  return resp.json();
}

// ══════════════════════════════════════
// SEND VERIFIKATIONSKODE via E-MAIL
// ══════════════════════════════════════
exports.sendVerifyCode = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method not allowed");
      const { email, signerName, signingId, signerIdx, docTitle } = req.body;
      if (!email || !signingId) return res.status(400).json({ error: "Mangler e-mail eller signingId" });

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Date.now() + 5 * 60 * 1000;

      await db.collection("verifyCodes").doc(signingId + "_" + signerIdx).set({
        code, email, expiresAt, attempts: 0, verified: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await sendEmail(email, "Din PilotSign verifikationskode", `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <div style="text-align:center;margin-bottom:20px;">
            <div style="display:inline-block;background:linear-gradient(135deg,#3b7dff,#6c5ce7);color:white;padding:8px 16px;border-radius:8px;font-weight:bold;font-size:18px;">PilotSign</div>
          </div>
          <p style="color:#444;font-size:14px;">Hej ${signerName || ""},</p>
          <p style="color:#444;font-size:14px;">Du er ved at signere <strong>${docTitle || "et dokument"}</strong>. Brug koden herunder:</p>
          <div style="text-align:center;margin:24px 0;">
            <div style="display:inline-block;background:#f5f5f5;padding:16px 32px;border-radius:12px;font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a1a1a;">${code}</div>
          </div>
          <p style="color:#999;font-size:12px;text-align:center;">Koden udloeber om 5 minutter.</p>
          <p style="color:#bbb;font-size:11px;text-align:center;margin-top:24px;">PilotSign — Pakkepiloten</p>
        </div>
      `);

      await db.collection("signings").doc(signingId).collection("audit").add({
        time: new Date().toISOString(), type: "info", text: "Verifikationskode sendt til " + email
      });

      return res.json({ success: true, message: "Kode sendt til " + email });
    } catch (err) {
      console.error("sendVerifyCode fejl:", err);
      return res.status(500).json({ error: "Intern fejl" });
    }
  });
});

// ══════════════════════════════════════
// BEKRAEFT VERIFIKATIONSKODE
// ══════════════════════════════════════
exports.verifyCode = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method not allowed");
      const { code, signingId, signerIdx } = req.body;
      if (!code || !signingId) return res.status(400).json({ error: "Mangler kode eller signingId" });

      const docRef = db.collection("verifyCodes").doc(signingId + "_" + signerIdx);
      const doc = await docRef.get();
      if (!doc.exists) return res.status(404).json({ error: "Ingen kode fundet" });

      const data = doc.data();
      if (Date.now() > data.expiresAt) return res.status(410).json({ error: "Koden er udloebet" });
      if (data.attempts >= 5) return res.status(429).json({ error: "For mange forsoeg" });

      if (data.code !== code) {
        await docRef.update({ attempts: admin.firestore.FieldValue.increment(1) });
        return res.status(401).json({ error: "Forkert kode", attemptsLeft: 5 - data.attempts - 1 });
      }

      await docRef.update({ verified: true });
      await db.collection("signings").doc(signingId).collection("audit").add({
        time: new Date().toISOString(), type: "ok", text: "E-mail-verifikation bekraeftet for " + data.email
      });

      return res.json({ success: true, verified: true });
    } catch (err) {
      console.error("verifyCode fejl:", err);
      return res.status(500).json({ error: "Intern fejl" });
    }
  });
});

// ══════════════════════════════════════
// SEND SIGNERINGS-INVITATION
// ══════════════════════════════════════
exports.sendSigningEmail = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method not allowed");
      const { to, signerName, docTitle, signingUrl, message, deadline } = req.body;
      if (!to || !docTitle) return res.status(400).json({ error: "Mangler data" });

      await sendEmail(to, "Underskriv venligst: " + docTitle, `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;background:linear-gradient(135deg,#3b7dff,#6c5ce7);color:white;padding:8px 16px;border-radius:8px;font-weight:bold;font-size:18px;">PilotSign</div>
          </div>
          <h2 style="color:#1a1a1a;font-size:20px;">Hej ${signerName || ""},</h2>
          <p style="color:#444;font-size:14px;line-height:1.6;">Du har modtaget et dokument til digital signering:</p>
          <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
            <div style="font-size:16px;font-weight:bold;color:#1a1a1a;">${docTitle}</div>
            ${deadline ? '<div style="font-size:13px;color:#666;margin-top:4px;">Frist: ' + deadline + "</div>" : ""}
          </div>
          ${message ? '<p style="color:#444;font-size:14px;line-height:1.6;background:#fafafa;padding:12px;border-left:3px solid #3b7dff;border-radius:4px;">' + message + "</p>" : ""}
          <div style="text-align:center;margin:24px 0;">
            <a href="${signingUrl}" style="display:inline-block;background:#3b7dff;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;font-size:15px;">Underskriv dokument</a>
          </div>
          <p style="color:#999;font-size:11px;text-align:center;margin-top:24px;">PilotSign — Pakkepiloten</p>
        </div>
      `);

      return res.json({ success: true });
    } catch (err) {
      console.error("sendSigningEmail fejl:", err);
      return res.status(500).json({ error: "Intern fejl" });
    }
  });
});

// ══════════════════════════════════════
// SEND PAAMINDELSE
// ══════════════════════════════════════
exports.sendReminder = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method not allowed");
      const { to, signerName, docTitle, signingUrl, deadline } = req.body;
      if (!to || !docTitle) return res.status(400).json({ error: "Mangler data" });

      await sendEmail(to, "Paamindelse: Underskriv venligst — " + docTitle, `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;background:linear-gradient(135deg,#3b7dff,#6c5ce7);color:white;padding:8px 16px;border-radius:8px;font-weight:bold;font-size:18px;">PilotSign</div>
          </div>
          <h2 style="color:#1a1a1a;font-size:20px;">Paamindelse</h2>
          <p style="color:#444;font-size:14px;">Hej ${signerName || ""}, du har stadig et ventende dokument:</p>
          <div style="background:#fff3e0;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #ff9800;">
            <div style="font-size:16px;font-weight:bold;">${docTitle}</div>
            ${deadline ? '<div style="font-size:13px;color:#e65100;margin-top:4px;">Frist: ' + deadline + "</div>" : ""}
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${signingUrl}" style="display:inline-block;background:#ff9800;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;">Underskriv nu</a>
          </div>
          <p style="color:#999;font-size:11px;text-align:center;">PilotSign — Pakkepiloten</p>
        </div>
      `);

      return res.json({ success: true });
    } catch (err) {
      console.error("sendReminder fejl:", err);
      return res.status(500).json({ error: "Intern fejl" });
    }
  });
});

// ══════════════════════════════════════
// SEND FULDFOERT-KVITTERING
// ══════════════════════════════════════
exports.sendCompletionNotice = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method not allowed");
      const { recipients, docTitle } = req.body;
      if (!recipients || !docTitle) return res.status(400).json({ error: "Mangler data" });

      for (const r of recipients) {
        await sendEmail(r.email, "Dokument fuldfoert: " + docTitle, `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;background:linear-gradient(135deg,#3b7dff,#6c5ce7);color:white;padding:8px 16px;border-radius:8px;font-weight:bold;font-size:18px;">PilotSign</div>
            </div>
            <div style="text-align:center;margin:20px 0;">
              <div style="font-size:48px;">✅</div>
              <h2 style="color:#2ed47a;font-size:20px;">Dokument fuldfoert!</h2>
            </div>
            <p style="color:#444;font-size:14px;">Hej ${r.name}, alle parter har nu underskrevet:</p>
            <div style="background:#e8f5e9;padding:16px;border-radius:8px;margin:16px 0;">
              <div style="font-size:16px;font-weight:bold;">${docTitle}</div>
              <div style="font-size:13px;color:#666;margin-top:4px;">Alle ${recipients.length} underskrivere har signeret</div>
            </div>
            <p style="color:#999;font-size:11px;text-align:center;">PilotSign — Pakkepiloten</p>
          </div>
        `);
      }

      return res.json({ success: true, sent: recipients.length });
    } catch (err) {
      console.error("sendCompletionNotice fejl:", err);
      return res.status(500).json({ error: "Intern fejl" });
    }
  });
});
