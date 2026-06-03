# ♟ Dual Kingdom Chess

2v2 male variant 16×8 lauaga. Hele tiim (Valge + Kollane) vs Tume tiim (Must + Pruun).

## Kuidas üles panna (samm-samm)

### 1. Tee GitHub repo

1. Mine [github.com](https://github.com) → logi sisse
2. Vajuta roheline nupp **"New"**
3. Nimi: `dual-kingdom-chess`
4. Jäta kõik vaikimisi, vajuta **"Create repository"**

### 2. Lae failid üles

GitHub repo lehel vajuta **"uploading an existing file"** ja lohista kõik kolm faili:
- `index.html`
- `partykit.json`
- `party/index.js` *(loo kõigepealt kaust `party`, siis lae sisse)*

Vajuta **"Commit changes"**.

### 3. Ava GitHub Codespaces

1. Repo lehel vajuta roheline **"Code"** nupp
2. Vali **"Codespaces"** tab
3. Vajuta **"Create codespace on main"**
4. Ava terminal (Ctrl+` või View → Terminal)

### 4. Deploy PartyKit

Terminalis:
```bash
npx partykit@latest deploy --name dual-kingdom-chess
```

Kui küsib logi sisse → vajuta `Y` → logi sisse GitHub kontoga.

Pärast deployti näed midagi sellist:
```
Deployed to: dual-kingdom-chess.SINUNIMI.partykit.dev
```

### 5. Uuenda `index.html`

Ava `index.html` Codespaces'is, leia see rida:
```
"dual-kingdom-chess.YOURNAME.partykit.dev"
```
Asenda `YOURNAME` oma GitHub kasutajanimega. Salvesta ja commit.

### 6. Lülita sisse GitHub Pages

1. Repo Settings → Pages
2. Source: **"Deploy from branch"**
3. Branch: **main** / root
4. Save

Mõne minuti pärast on mäng saadaval:
`https://SINUNIMI.github.io/dual-kingdom-chess`

Jaga seda linki sõpradele — kõik 4 avaavad sama URL-i ja mängivad!

## Mängureeglid

- **Käigujärjestus:** Valge → Must → Kollane → Pruun
- **Tiimid:** Valge + Kollane vs Must + Pruun
- Kui mõlemal tiimiliikmel on kuningas elus: saab anda oma käigu tiimikaaslasele
- Elimineeritud mängija nupud lähevad tiimikaaslasele
- Võidab tiim, kes elimineerib mõlemad vastased
