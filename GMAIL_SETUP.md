# Gmail Integration Setup for ServOS Support

## Overview
Connects support@serv-os.app Gmail account to the CRM.
- Inbound: polls Gmail for new unread emails, creates/threads tickets
- Outbound: sends email replies via Gmail API from support@serv-os.app

## Step 1: Google Cloud Console

1. Go to https://console.cloud.google.com
2. Create a new project (or use existing): "ServOS CRM"
3. Enable the Gmail API:
   - APIs & Services > Library > search "Gmail API" > Enable
4. Create OAuth credentials:
   - APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID
   - Application type: Web application
   - Name: "ServOS CRM Gmail"
   - Authorized redirect URIs: add `https://developers.google.com/oauthplayground`
   - Save the **Client ID** and **Client Secret**

## Step 2: Get Refresh Token

1. Go to https://developers.google.com/oauthplayground
2. Click the gear icon (top right) > check "Use your own OAuth credentials"
3. Enter your Client ID and Client Secret
4. In Step 1 (left panel), find "Gmail API v1" and select:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
5. Click "Authorize APIs"
6. Sign in as support@serv-os.app
7. In Step 2, click "Exchange authorization code for tokens"
8. Copy the **Refresh Token** (it starts with `1//`)

## Step 3: Supabase Secrets

Go to Supabase Dashboard > Edge Functions > Secrets and add:

| Secret Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | Your OAuth Client ID |
| `GMAIL_CLIENT_SECRET` | Your OAuth Client Secret |
| `GMAIL_REFRESH_TOKEN` | The refresh token from Step 2 |

## Step 4: Deploy Edge Functions

```bash
cd posupject
supabase functions deploy gmail-check --project-ref yuevuqvldtmjwwzjrddo
supabase functions deploy gmail-send --project-ref yuevuqvldtmjwwzjrddo
```

## Step 5: Set Up Polling (pg_cron)

In the Supabase SQL Editor, run:

```sql
-- Check Gmail every 60 seconds
SELECT cron.schedule(
  'gmail-check',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yuevuqvldtmjwwzjrddo.supabase.co/functions/v1/gmail-check',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);
```

Or manually test by calling:
```
curl -X POST https://yuevuqvldtmjwwzjrddo.supabase.co/functions/v1/gmail-check \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

## How It Works

### Inbound (customer emails support@serv-os.app)
1. Email arrives in Gmail inbox
2. `gmail-check` polls every 60 seconds
3. For each unread email:
   - Matches sender email to contacts table
   - If Gmail thread matches an existing ticket: threads into it
   - If no match: creates a new ticket
   - If ticket was closed: auto-reopens to "in_progress"
   - Creates crm_activities record with type='email', direction='inbound'
   - Marks email as read in Gmail

### Outbound (agent replies from CRM)
1. Agent opens ticket, clicks Email tab
2. To address auto-fills from ticket's customer_email
3. Agent writes reply and clicks Send
4. `gmail-send` edge function:
   - Sends via Gmail API as support@serv-os.app
   - Sets In-Reply-To headers for proper threading in customer's inbox
   - Uses Gmail threadId so reply appears in same thread
   - Creates crm_activities record with type='email', direction='outbound'
   - Moves ticket to "waiting_on_customer" if it was "new"

### Threading
- Gmail thread IDs are stored in ticket_email_threads table
- Customer's replies land in the same Gmail thread
- CRM matches by thread ID to the right ticket
- Customer sees a proper email thread in their inbox
