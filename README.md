# Дом на Хвойной

## Requirements
- Node.js 20+
- PostgreSQL

## Local
1. `npm ci`
2. `npm start`

## Environment variables
Create a local `.env` file from `.env.example` and set:
- `DATABASE_URL`
- `OWNER_PHONE`
- `OWNER_PASSWORD`
- `PORT`
- `NODE_ENV`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OWNER_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`

No real secrets should be committed to the repository.

## Database
- `schema.sql` creates the database structure.
- `seed.sql` contains only demo data for local/demo development.
- `seed.sql` must not be run against production.

## Amvera
For deployment, set the required environment variables in the Amvera UI and keep secrets as protected values:
- `OWNER_PASSWORD` — set as SECRET
- `TELEGRAM_BOT_TOKEN` — set as SECRET
- `TELEGRAM_WEBHOOK_SECRET` — set as SECRET
- `DATABASE_URL` — preferably set as SECRET
- `OWNER_PHONE` — can be a normal variable or a secret

Then run:
- `npm ci`
- `npm start`
- `PORT` as the exposed port value

## Notes
- `schema.sql` creates the production database structure.
- `seed.sql` is only for local/demo use and must not be run in production.
- The frontend is preserved as a static build and should not be redesigned in this pass.
