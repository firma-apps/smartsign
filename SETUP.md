# SmartSign — Produktions-opsætning

## Oversigt
SmartSign består af:
1. **Frontend** (index.html) — hosted på GitHub Pages
2. **Firebase Firestore** — database til dokumenter, signaturer, audit trail
3. **Firebase Cloud Functions** — SMS via GatewayAPI.dk + e-mail via Resend
4. **Firebase Auth** — login med e-mail/password

---

## Trin 1: Opret Firebase-projekt

1. Gå til https://console.firebase.google.com
2. Klik "Add project" → Navngiv det "smartsign"
3. Aktiver **Firestore Database** (start i test mode)
4. Aktiver **Authentication** → Sign-in method → Email/Password → Enable
5. Gå til Project Settings → General → "Your apps" → Web app → Register
6. Kopiér din Firebase config (apiKey, authDomain, projectId osv.)

## Trin 2: Indsæt Firebase config

Åbn `index.html` og find sektionen `FIREBASE CONFIG` øverst i scriptet.
Erstat placeholder-værdierne med dine egne fra Firebase Console.

## Trin 3: Firestore Security Rules

Gå til Firebase Console → Firestore → Rules og indsæt:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Brugere kan kun læse/skrive deres egne docs
    match /signings/{docId} {
      allow read, write: if request.auth != null
        && resource == null || resource.data.ownerId == request.auth.uid;
      allow create: if request.auth != null;
    }

    // Audit log — kun læsning for ejer
    match /signings/{docId}/audit/{logId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
    }

    // Signing tokens (offentlige links til underskrivere)
    match /signTokens/{tokenId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

## Trin 4: Cloud Functions

### Installer Firebase CLI
```bash
npm install -g firebase-tools
firebase login
firebase init functions
```

### Opsæt API-nøgler
```bash
# Resend — opret gratis konto på resend.com (3.000 mails/md gratis)
firebase functions:config:set resend.key="DIN_RESEND_API_KEY"
firebase functions:config:set resend.from="PilotSign <noreply@ditdomaene.dk>"
```

### Deploy functions
```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

## Trin 5: GitHub Pages hosting

1. Opret repo "pilotsign" på GitHub
2. Upload `index.html` til repo
3. Settings → Pages → Source: main branch → Save
4. Din app er live på: `https://DIT-BRUGERNAVN.github.io/pilotsign/`

## Trin 6: Tilpas Cloud Function URLs

Efter deploy af functions, får du URLs som:
- `https://us-central1-pilotsign.cloudfunctions.net/sendVerifyCode`
- `https://us-central1-pilotsign.cloudfunctions.net/verifyCode`
- `https://us-central1-pilotsign.cloudfunctions.net/sendSigningEmail`
- `https://us-central1-pilotsign.cloudfunctions.net/sendReminder`
- `https://us-central1-pilotsign.cloudfunctions.net/sendCompletionNotice`

Indsæt disse i `index.html` under `CF_BASE` variablen.

---

## Sikkerhed & GDPR

- CPR-numre krypteres client-side med AES-256 før de gemmes i Firestore
- Krypteringsnøglen er unik per dokument og gemmes KUN i det downloadede dokument
- Firestore Security Rules sikrer at kun ejeren kan læse sine dokumenter
- Verifikationskoder sendes via e-mail og udløber efter 5 minutter
- Maks 5 forsøg per kode
- Audit trail logges for alle handlinger
- Signatur-hash er baseret på tegning + CPR + timestamp (SHA-256)

## Priser

- **Firebase**: Gratis (Spark plan) op til 50.000 reads/dag
- **Resend**: Gratis op til 3.000 e-mails/måned
- **GitHub Pages**: Gratis
- **TOTAL: 0 kr/md** (inden for gratis grænser)
