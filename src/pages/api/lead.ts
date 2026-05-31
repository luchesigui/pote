export const prerender = false;

import type { APIRoute } from 'astro';
import postgres from 'postgres';

const databaseUrl = import.meta.env.DATABASE_URL || process.env.DATABASE_URL;

let sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (!sql) {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not defined.');
    }
    sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 10,
      idle_timeout: 20,
      onnotice: () => {}, // Suppress notice messages (like table/column already exists) to keep logs clean
    });
  }
  return sql;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Corpo da requisição inválido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { name, email } = body;

    // Validate name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return new Response(JSON.stringify({ error: 'Nome é obrigatório.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate email
    if (!email || typeof email !== 'string' || !email.trim()) {
      return new Response(JSON.stringify({ error: 'E-mail é obrigatório.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return new Response(JSON.stringify({ error: 'Por favor, insira um e-mail válido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getSql();

    // 1. Ensure the leads table exists
    await db`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 2. Ensure Name column is added for backward compatibility (if table was created before)
    await db`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS name VARCHAR(255)
    `;

    // 3. Insert or update the lead
    await db`
      INSERT INTO leads (name, email)
      VALUES (${name.trim()}, ${email.trim().toLowerCase()})
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    `;

    // 4. Send email notification via Resend
    const resendApiKey = import.meta.env.RESEND_API_KEY || process.env.RESEND_API_KEY || 're_d6DbDxc3_C3SwxKmZNSt3gN1W9Kg3NdbF';
    const emailFrom = import.meta.env.RESEND_EMAIL_FROM || process.env.RESEND_EMAIL_FROM || 'onboarding@resend.dev';
    const emailTo = import.meta.env.RESEND_EMAIL_TO || process.env.RESEND_EMAIL_TO || 'mandy.yoshiizumi@gmail.com';

    try {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: emailTo,
          subject: 'Novo lead capturado! 🚀',
          html: `<p>Um novo lead se inscreveu na lista de espera:</p>
                 <ul>
                   <li><strong>Nome:</strong> ${name.trim()}</li>
                   <li><strong>E-mail:</strong> ${email.trim().toLowerCase()}</li>
                 </ul>`,
        }),
      });

      if (!emailResponse.ok) {
        const errorText = await emailResponse.text();
        console.error('Resend API error response:', errorText);
      } else {
        console.log('Lead notification email sent successfully.');
      }
    } catch (emailError) {
      console.error('Failed to send lead notification email via Resend:', emailError);
    }

    return new Response(JSON.stringify({ success: true, message: 'Fila de espera garantida!' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error in /api/lead:', error);
    return new Response(
      JSON.stringify({ error: 'Ocorreu um erro ao salvar seu e-mail. Tente novamente.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
