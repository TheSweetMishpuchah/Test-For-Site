# Sweet Mishpuchah — Bakery Website

A full bakery storefront: menu ribbon, gallery, real cart + checkout, customer
accounts, order history, moderated reviews, contact form, English ⇄ Russian, and
emailed PDF receipts.

## Architecture (GitHub Pages + Google Apps Script)

The site is split into two pieces so you can use **your own domain** *and* have a
real working backend:

```
  index.html  ──hosted on──►  GitHub Pages  (your custom domain)  =  "the looks"
       │
       │  fetch() over the internet  (orders, accounts, reviews, emails)
       ▼
   Code.gs    ──hosted on──►  Google Apps Script  (/exec URL)     =  "the brains"
                                   └─ reads/writes your Google Sheet + sends mail
```

- **`index.html`** — the entire front-end (one file). Hosted on **GitHub Pages**.
- **`Code.gs`** — a JSON API. Hosted on **Google Apps Script**. Stores everything
  in your Google Sheet and sends receipt emails.
- **`Receipt.html`** — the emailed PDF receipt (used by Apps Script).
- **`appsscript.json`** — Apps Script project settings.

> The front-end calls the backend with a "simple" `text/plain` request on purpose,
> so the browser sends no CORS pre-flight (which Apps Script can't answer). Nothing
> for you to configure — it just works once the URL is in place.

---

## Deployment — do Part A, then Part B

### Part A — The backend (Google Apps Script)

1. Go to <https://script.google.com> → **New project**.
2. Paste **`Code.gs`** into the default script file.
3. **File ▸ New ▸ HTML file**, name it exactly **`Receipt`**, paste in **`Receipt.html`**.
4. Confirm `SHEET_ID` in `Code.gs` points to your Google Sheet (it already does).
   Open that sheet once, or run the `setupSheets` function from the editor to
   create the **Orders / Users / Reviews / Contact / PasswordResets** tabs.
5. **Deploy ▸ New deployment ▸ Web app**
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**  ← required, so your website can reach it
   - **Deploy**, authorize the permissions (Sheets + Gmail).
6. **Copy the Web-app URL** — it ends in **`/exec`**. You need it for Part B.

### Part B — The front-end (GitHub Pages + your domain)

1. Open **`index.html`**, find the `CONFIG` block near the top of the `<script>`,
   and paste your URL:
   ```js
   WEBAPP_URL: "https://script.google.com/macros/s/AKfyc..../exec",
   ```
2. Put `index.html` in your repo (the file **must be named `index.html`** for
   Pages to serve it at the root).
3. In your repo: **Settings ▸ Pages** → *Source:* **Deploy from a branch** →
   **main** / **/(root)** → **Save**.
4. (Optional) On that same Pages screen, set your **custom domain** and follow
   GitHub's DNS instructions (a `CNAME` record to `<your-user>.github.io`).
5. Visit your domain — the site is live and fully working.
6. On the live site, go to **Account ▸ Create Account** and sign up with
   **thesweetmishpuchah@gmail.com** to become the **admin**.

> **When you change the backend later:** edit `Code.gs`, then **Deploy ▸ Manage
> deployments ▸ (edit) ▸ Version: New version ▸ Deploy**. The `/exec` URL stays
> the same, so you don't need to touch `index.html` again.

*(Prefer everything on Google instead? You can also paste `index.html` into the
Apps Script project as an HTML file named `IndexM`, leave `WEBAPP_URL` empty, and
the same site runs entirely on the Apps Script URL — no GitHub needed. The custom
domain is the reason we use GitHub Pages.)*

---

## Editing the things you'll actually change

### ➕ Add / edit a cake (and its extra design photos)
In **`index.html`**, find `const CAKES = [` near the top of the `<script>`.
Each cake looks like this:

```js
{
  id:0, name:"Medovik", nameRu:"Медовик", category:"Classic",
  tag:"Best Seller", tagRu:"Хит продаж",
  img:"https://i.imgur.com/Q62En7b.jpeg", price:"$100",
  size:"10 inches.", sizeRu:"10 дюймов.",
  serves:"10–15 people.", servesRu:"10–15 человек.",
  desc:"…english…",      descRu:"…русский…",
  ingr:"…english…",      ingrRu:"…русский…",
  variations:[                       // ← the extra design photos
    { img:"https://i.imgur.com/Q62En7b.jpeg" },          // plain photo, reuses the text above
    { img:"https://i.imgur.com/jE6fRsM.png",
      name:"Chocolate Glazed Medovik", nameRu:"Медовик в шоколадной глазури",
      desc:"…", descRu:"…", ingr:"…", ingrRu:"…", id:"chocolate-glazed-medovik" }
  ]
}
```

- **More photos of the same cake:** add more `{ img:"…" }` entries to `variations`.
  The popup arrows flip through them.
- **A photo that's really a different flavor/option:** give that variation its own
  `name` / `desc` / `price` / `id` and it becomes its own "Add to cart" item.
- `id` numbers must stay unique. The ribbon **and** gallery read this one list.

### 📅 Order calendar (blocked days)
In **`Code.gs`** → CONFIG (mirror the same numbers in `index.html` → `var CONFIG`):

```js
const BLOCK_BEFORE_DAYS      = 3;  // next N days from today, always blocked (slides daily)
const BLOCK_AFTER_ORDER_DAYS = 2;  // days blocked after each booked order
const MAX_ORDERS_PER_DAY     = 2;  // orders allowed on the same day
```

### 💳 Payment handles / pickup address / bakery name
`Code.gs` → CONFIG: `BAKERY_NAME`, `PICKUP_ADDRESS`, and `PAYMENT_HANDLES`
(`zelle`, `venmo`, `cashapp`, `cash`).

### 📣 Promotion banner & 🌐 translations
All interface text is in the `I18N = { en:{…}, ru:{…} }` object in `index.html`
(promo banner = `promo.title` / `promo.line1` / `promo.line2`). Cake text uses the
`…Ru` fields shown above; a blank Russian field falls back to English.

---

## Feature checklist
- ✅ Ribbon is the **first** thing on the homepage (with descriptions + ingredients),
  with the **Attention promo** banner directly beneath it.
- ✅ Ribbon & gallery share one cake list; modal arrows flip through **multiple
  design photos** per cake; homepage emojis replaced with **cake photos**.
- ✅ **Add to Cart** + real **checkout**: moving blocked calendar, name, phone,
  email, cake writing, payment (Zelle / Cash App / Venmo / Cash), Place Order +
  Clear Cart.
- ✅ **Accounts**, **order history**, **forgot-password**; **admin** moderates
  reviews and resets/sign-out locked-out customers.
- ✅ Reviews moderated before publishing; contact form emails the bakery; "Lead
  Time" → **Bake Time**.
- ✅ Full **English ⇄ Russian** toggle.
- ✅ Orders + emailed **PDF receipt**; everything saved to Google Sheets.
- ✅ Works as **GitHub Pages + Apps Script**, all-on-Apps-Script, or an offline
  file demo.

## Notes
- Passwords are stored hashed (SHA-256 + per-account salt) in the `Users` tab.
- Contact phone shows "Available on request"; change it in `index.html` →
  `contact.phoneValue` whenever you want to show a number.
- All data lives in one spreadsheet with separate tabs; change `SHEET_ID`/tab
  names in `Code.gs` to split it later.
