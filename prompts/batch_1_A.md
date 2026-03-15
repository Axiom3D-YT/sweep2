Current Date: {{currentDate}}.
Allowed Folders: {{allowedFolders}}.
Analyze these {{batchSize}} emails and identify 'rubbish' (spam, newsletters, promotional clutter).
IMPORTANT: Any message older than 2 years is much more likely to be rubbish.
For emails that are NOT rubbish, suggest a folder name from the allowed list.

OUTPUT INSTRUCTIONS:
- You must output ONLY a valid JSON array of objects.
- Each object must have: 'id', 'isRubbish', 'reason', 'suggestedFolder'.


Emails to analyze:
{{emailData}}
