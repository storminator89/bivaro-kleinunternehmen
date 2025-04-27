# Buchhaltung

Buchhaltung is a web-based accounting application designed to help users manage their finances, track expenses and incomes, and handle invoices efficiently. Built with Next.js, TypeScript, and Prisma, it provides a modern and secure platform for personal or small business bookkeeping.

## Features

- User authentication and registration
- Dashboard overview of financial data
- Expense and income tracking
- Invoice management (upload, download, and storage)
- Tax-deductible percentage tracking for expenses
- Secure file uploads for receipts and invoices
- Responsive and modern UI

## Tech Stack

- Next.js (React)
- TypeScript
- Prisma (SQLite)
- NextAuth.js (Authentication)
- Tailwind CSS (Styling)
- PostCSS

## Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/storminator89/bivaro-kleinunternehmen
   cd buchhaltung
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up the database:**
   ```bash
   npx prisma migrate dev
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

Create a `.env` file in the `buchhaltung/` directory with the following variables:

```
DATABASE_URL="file:./dev.db"
# NextAuth configuration
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"
```

- `DATABASE_URL`: Path to your SQLite database file (default: `file:./dev.db`).
- `NEXTAUTH_SECRET`: Secret key for NextAuth session encryption. Change this in production.
- `NEXTAUTH_URL`: The base URL of your application (e.g., `http://localhost:3000`).

You can use the provided `.env.example` as a template.

## Project Structure

- `app/` - Main application pages and API routes
- `components/` - Reusable UI and logic components
- `lib/` - Utility functions and Prisma client
- `prisma/` - Database schema and migrations
- `public/` - Static files and uploads

## Screenshots

![Dashboard Screenshot](public/screenshot/dashboard.png)

## License

This project is licensed under the MIT License.
