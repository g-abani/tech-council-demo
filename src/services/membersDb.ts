/**
 * PostgreSQL access for `members` demo table (PII handling demo).
 * Set `DATABASE_URL` or `POSTGRES_URL` (e.g. postgresql://user:pass@localhost:5432/tech_council_demo).
 */

import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function isMembersDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim());
}

function getPool(): pg.Pool {
  const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL or POSTGRES_URL is not set");
  }
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 5 });
  }
  return pool;
}

export type MemberRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  credit_card_number: string;
  ssn: string;
};

export async function findMembersByFirstName(firstName: string): Promise<MemberRow[]> {
  const p = getPool();
  const { rows } = await p.query<MemberRow>(
    `SELECT id, first_name, last_name, email, credit_card_number, ssn
     FROM members
     WHERE LOWER(TRIM(first_name)) = LOWER(TRIM($1))
     ORDER BY id
     LIMIT 10`,
    [firstName]
  );
  return rows;
}

/** Public fields only — for demo user picker + Graph RBAC (no PII columns). */
export type MemberListItem = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

export async function listMembersForDemo(): Promise<MemberListItem[]> {
  const p = getPool();
  const { rows } = await p.query<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  }>(
    `SELECT id, first_name, last_name, email
     FROM members
     ORDER BY last_name, first_name, id`
  );
  return rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
  }));
}
