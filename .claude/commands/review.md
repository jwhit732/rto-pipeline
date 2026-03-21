Open the interactive email review CLI.

## Behaviour
- Run `npm run review`
- This opens an interactive terminal interface
- Tell the user the controls before launching:
  - 'a' = approve this email
  - 'e' = edit (opens in your default editor)
  - 's' = skip this RTO
  - 'q' = quit and save progress (resume next time)

## Notes
- Progress is saved automatically — you can quit and resume anytime
- Only approved emails move to the send step
- The review shows plain text preview — the sent version will be HTML with clickable links
- Approved emails are saved to data/approved/
