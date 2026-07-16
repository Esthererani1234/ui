# GoldOnTheSpot authentication delivery

Use these production settings in Supabase Authentication:

- Sender name: `GoldOnTheSpot`
- Sender address: `security@goldonthespot.com`
- Confirmation subject: `Confirm your GoldOnTheSpot account`
- Recovery subject: `Reset your GoldOnTheSpot password`
- Confirmation template: `confirm-signup.html`
- Recovery template: `reset-password.html`
- SMS template: `Your GoldOnTheSpot security code is {{ .Code }}. It expires shortly. Never share this code.`

Connect a custom SMTP provider before marking branded email as ready in the
admin Security screen. Resend, Postmark, Amazon SES, or SendGrid can provide
SMTP delivery. Configure SPF, DKIM, and DMARC for `goldonthespot.com` before
sending production authentication email.

For SMS MFA, connect Twilio, MessageBird, or Vonage in Supabase, enable phone
MFA enrollment and verification, then send a real test code before enabling
the customer requirement in the admin Security screen.
