# ShowOps

Team task tracker for shows: requests, assignments, blockers, timelines and an activity log.

- **Website:** these files, hosted free on GitHub Pages
- **Database + logins:** Supabase (free plan)

## Files

| File | What it is | Do you edit it? |
|---|---|---|
| `database-setup.sql` | Creates the database. Run it once in Supabase → SQL Editor. | No |
| `config.js` | Your Supabase Project URL and Publishable key. | **Yes, once** |
| `index.html`, `app.js`, `style.css` | The website itself. | No |

Follow the step-by-step setup guide that came with these files.

## Roles

- **Pending**: just signed up and can't see anything yet
- **Writer**: raises requests, only inside the request window
- **Ops**: assigns, reassigns and updates tasks, and adds shows
- **Manager**: does everything, including priority, roles and settings

The first account created becomes the Manager.
