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
For deployment, set the required environment variables, then run:
- `npm ci`
- `npm start`
- `PORT` as the exposed port value

## Notes
- `schema.sql` applies the database structure.
- `seed.sql` is only for local/demo use and must not be used in production.
- The frontend is preserved as a static build and should not be redesigned in this pass.
