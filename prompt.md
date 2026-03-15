Current Date: {{currentDate}}.
Analyze this email and identify "rubbish" (spam, newsletters, promotional clutter). 
IMPORTANT: Any message older than 2 years is much more likely to be rubbish.
For emails that are NOT rubbish, suggest a folder name (label) to organize them into (e.g., "Work", "Finance", "Travel", "Personal").

OUTPUT INSTRUCTIONS:
- You must output ONLY a valid JSON object.
- DO NOT provide any explanation, thinking, or introductory text.
- Do not use markdown blocks (no ```json).
- The JSON object must have exactly these keys: "id", "isRubbish", "reason", "suggestedFolder".

Email to analyze:
{{emailData}}
