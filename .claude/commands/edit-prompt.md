Edit the email generation prompt to change tone, content, or style.

## Behaviour
1. Read the current system prompt from `src/generate/claude-client.ts`
2. Show the user the current prompt
3. Ask what they want to change
4. Make the edit
5. Run `npm run generate -- --limit 2 --dry-run` to preview the new output
6. Ask if they're happy with the change

## Common requests
- "Make it shorter" → reduce the word count target
- "More casual" → adjust the tone instructions
- "Don't mention compliance" → add to the "Do NOT" list
- "Change the sign-off" → update SENDER_NAME in .env or the prompt
- "Focus on time savings" → adjust the benefit framing
- "Add an unsubscribe line" → add to the email footer template

## Important
- The prompt lives in src/generate/claude-client.ts in the system prompt string
- After editing, always preview with a dry run to check the output
- Changes affect all future generated emails, not already-generated drafts
