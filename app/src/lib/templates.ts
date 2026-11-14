// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Note templates. Your own templates are ordinary notes in a folder called "Templates"
// (so they sync, share and export like everything else). A few ready-made ones come with
// the app. These words are filled in when a note is made from a template:
//
//   {{title}}   {{date}}   {{time}}   {{datetime}}   {{weekday}}

import type { Lang } from './i18n.ts';

export const TEMPLATES_FOLDER = 'Templates';

export interface BuiltIn {
  id: string;
  name: Record<Lang, string>;
  /** The title of the new note (may use the words above). */
  title: string;
  body: Record<Lang, string>;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fill(text: string, title: string, now = new Date(), lang: Lang = 'en'): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const weekday = new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', { weekday: 'long' }).format(now);
  return text
    .replace(/\{\{\s*title\s*\}\}/gi, title)
    .replace(/\{\{\s*datetime\s*\}\}/gi, `${date} ${time}`)
    .replace(/\{\{\s*date\s*\}\}/gi, date)
    .replace(/\{\{\s*time\s*\}\}/gi, time)
    .replace(/\{\{\s*weekday\s*\}\}/gi, weekday);
}

export const BUILT_IN: BuiltIn[] = [
  {
    id: 'daily',
    name: { en: 'Daily note', ar: 'ملاحظة يومية' },
    title: '{{date}}',
    body: {
      en: `---
date: {{date}}
tags: [daily]
---
# {{weekday}}, {{date}}

## To do
- [ ] 

## Notes

`,
      ar: `---
date: {{date}}
tags: [يومي]
---
# {{weekday}} {{date}}

## المهام
- [ ] 

## ملاحظات

`,
    },
  },
  {
    id: 'meeting',
    name: { en: 'Meeting notes', ar: 'محضر اجتماع' },
    title: 'Meeting {{date}}',
    body: {
      en: `---
date: {{date}}
tags: [meeting]
---
# {{title}}

**People:** 

## Agenda
- 

## Decisions

## Actions
- [ ] 
`,
      ar: `---
date: {{date}}
tags: [اجتماع]
---
# {{title}}

**الحضور:** 

## جدول الأعمال
- 

## القرارات

## المهام
- [ ] 
`,
    },
  },
  {
    id: 'expenses',
    name: { en: 'Expenses with total', ar: 'مصروفات بإجمالي' },
    title: 'Expenses {{date}}',
    body: {
      en: `# {{title}}

| Item | Quantity | Unit price | Total |
|---|---|---|---|
|  | 1 | 0 | |
|  | 1 | 0 | |
| Total | | | |
<!-- qalamark
D = B * C
D in last row = total of D
-->
`,
      ar: `# {{title}}

| البند | العدد | سعر الوحدة | الإجمالي |
|---|---|---|---|
|  | 1 | 0 | |
|  | 1 | 0 | |
| الإجمالي | | | |
<!-- qalamark
D = B * C
D in last row = total of D
-->
`,
    },
  },
  {
    id: 'meter',
    name: { en: 'Meter readings', ar: 'قراءات العدّاد' },
    title: 'Meter {{date}}',
    body: {
      en: `# {{title}}

| Month | Date | Reading | Used | Days |
|---|---|---|---|---|
| | {{date}} | 0 | | |
| | | | | |
<!-- qalamark
D = change in C
E = days since previous B
-->
`,
      ar: `# {{title}}

| الشهر | التاريخ | القراءة | الاستهلاك | الأيام |
|---|---|---|---|---|
| | {{date}} | 0 | | |
| | | | | |
<!-- qalamark
D = change in C
E = days since previous B
-->
`,
    },
  },
];
