# Slade Gardens Adventure Playground – Staff Timesheets

A free, mobile-friendly timesheet app. The website is hosted on **GitHub Pages** (the root of this repository) and the logins and data are held in **Supabase**. Login codes are sent by email through **Brevo**.

**Live site:** https://adam-gibson.github.io/SladeGardens/

## What it does
- **Login without passwords:** staff enter their email and receive a login code. They stay logged in on their phone.
- **New staff:** the first time someone logs in they enter their forename, surname and mobile number, then wait for the administrator to approve them. The administrator can also add staff in advance, and those staff are approved automatically.
- **Staff:** log the date, activity, start and finish times, break and notes; hours are calculated for them. They can view past hours with totals, and edit or delete entries for 14 days, after which entries lock.
- **Administrator:** view everyone's hours for any dates, see totals per person, edit any entry, approve or deactivate staff, and **export a CSV file** (opens in Excel).
- **Phone app:** open the site on a phone and choose *Add to Home Screen*.

## One-off setup

### 1. Supabase
A **new project** is recommended so that this app's users, email wording and settings are kept separate from your other project. The free plan allows two active projects.

1. Open **SQL Editor → New query**. Paste in `supabase/schema.sql`, **change the administrator's email, name and phone at the bottom**, then click **Run**.
2. **Authentication → Sign In / Providers → Email:** make sure Email is enabled. Set *Email OTP Expiration* to `600` seconds (10 minutes).
3. **Authentication → Emails → SMTP Settings:** turn on custom SMTP with your Brevo details:
   - host `smtp-relay.brevo.com`, port `587`
   - your Brevo SMTP login and SMTP key
   - sender name *Slade Gardens Timesheets* and a sender address that is verified in Brevo
4. **Authentication → Emails → Templates:** edit both **Magic Link** and **Confirm signup** so that they show the code, for example:
   ```html
   <h2>Slade Gardens timesheets</h2>
   <p>Your login code is:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>It expires in 10 minutes. If you didn't ask for this, ignore this email.</p>
   ```
5. **Authentication → URL Configuration:** set the *Site URL* to `https://adam-gibson.github.io/SladeGardens/`.
6. **Project Settings → API Keys:** copy the *Project URL* and the *publishable* key (or the legacy *anon public* key) into `config.js`. Commit the change.

### 2. GitHub Pages
**Settings → Pages → Build and deployment:** set the source to *Deploy from a branch*, choose branch `main` and folder `/ (root)`, and save. The site appears at the address above within a minute or two.

### 3. First login
Open the site and log in with the administrator email you set in step 1. You will go straight to the admin view.

## Changing things
- **Activities list:** edit `activities` in `config.js`.
- **14-day edit window:** change `editWindowDays` in `config.js` **and** the three `current_date - 14` lines in `supabase/schema.sql`, then run the schema again. It is safe to run more than once.
- **Removing a member of staff:** in the Staff tab, set their status to *Inactive*. Their hours are kept.
- **Making someone an administrator:** in the Staff tab, edit them and set their role to *Admin*.

## Security
- The code is public, but it contains no secrets. The publishable key only lets someone *ask* Supabase for data. The rules in `schema.sql` (row level security) decide what each person can see or change:
  - staff can see only their own hours;
  - staff can add and change their own hours only within 14 days;
  - only active administrators can see everyone's hours or change anyone's role or status;
  - new accounts can do nothing until they are approved.
- The site is served over HTTPS. There are no passwords to leak, and login codes are single-use and short-lived. Supabase limits how often codes can be requested.
- Staff names, emails and phone numbers are personal data under UK GDPR. Add a line to the charity's privacy notice explaining that they are stored, with hours worked, for payroll.
- The free Supabase plan **pauses a project after 7 days without any use**. Normal weekly use keeps it awake. After a long closure, restore the project from the Supabase dashboard with one click; no data is lost.
- **Backups:** export a CSV regularly (for example, monthly). The free plan does not include downloadable backups.
