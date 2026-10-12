import { describe, it, expect } from 'vitest';
import { signTicket, uploadToken, ticketFromToken, uploadUrl, replyWithUpload }
  from '../../supabase/functions/_shared/uploadLink.ts';

const SECRET = 'service-role-key-stand-in';
const TICKET = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';

describe('the token on a photo upload link', () => {
  it('opens the ticket it was made for', async () => {
    const token = await uploadToken(TICKET, SECRET);
    expect(await ticketFromToken(token, SECRET)).toBe(TICKET);
  });

  it('is useless for any other ticket, even with a real signature', async () => {
    const sig = await signTicket(TICKET, SECRET);
    expect(await ticketFromToken(`${OTHER}.${sig}`, SECRET)).toBeNull();
  });

  it('fails when the signature is edited, missing or from another instance', async () => {
    const token = await uploadToken(TICKET, SECRET);
    expect(await ticketFromToken(token.slice(0, -1) + '0', SECRET)).toBeNull();
    expect(await ticketFromToken(TICKET, SECRET)).toBeNull();
    expect(await ticketFromToken(token, 'a-different-instances-secret')).toBeNull();
  });

  it('refuses rubbish instead of throwing', async () => {
    for (const bad of ['', '.', 'x.y', `${TICKET}.short`, 'not-a-uuid.0123456789abcdef', null, undefined]) {
      expect(await ticketFromToken(bad, SECRET)).toBeNull();
    }
  });

  it('gives the same answer every time, so a texted link keeps working', async () => {
    expect(await uploadToken(TICKET, SECRET)).toBe(await uploadToken(TICKET, SECRET));
  });

  it('builds a tidy url whether or not the app url has a trailing slash', () => {
    expect(uploadUrl('https://posupcrm.vercel.app', 'abc')).toBe('https://posupcrm.vercel.app/u/abc');
    expect(uploadUrl('https://posupcrm.vercel.app///', 'abc')).toBe('https://posupcrm.vercel.app/u/abc');
  });
});

describe('the auto reply that carries the link', () => {
  const link = 'https://posupcrm.vercel.app/u/tok';

  it('adds it on the end of the normal message', () => {
    const out = replyWithUpload("Thanks for messaging POSUP Support — we've got your message.", link);
    expect(out).toContain("we've got your message.");
    expect(out).toContain(`tap here: ${link}`);
  });

  it('puts it where the writer asked, with no second copy', () => {
    const out = replyWithUpload('Got it. Photos: {{upload_link}} — thanks.', link);
    expect(out).toBe(`Got it. Photos: ${link} — thanks.`);
    expect(out.match(/https/g)).toHaveLength(1);
  });

  it('never repeats a link the template already has', () => {
    const out = replyWithUpload(`Send photos to ${link}`, link);
    expect(out.match(/https/g)).toHaveLength(1);
  });

  it('copes with an empty template or no link', () => {
    expect(replyWithUpload('', link)).toBe(`To send us a photo, tap here: ${link}`);
    expect(replyWithUpload('Thanks.', '')).toBe('Thanks.');
  });
});
