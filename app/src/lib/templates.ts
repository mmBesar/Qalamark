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
    id: 'shopping-list',
    name: { en: 'Shopping list', ar: 'قائمة تسوّق' },
    title: 'Shopping list',
    body: {
      en: `---\nview: checklist\n---\n\n## Fruit and vegetables\n\n- [ ] Tomatoes\n- [ ] Bananas\n\n## Dairy\n\n- [ ] Milk\n- [ ] Eggs\n\n## Home\n\n- [ ] Soap\n`,
      ar: `---\nview: checklist\n---\n\n## خضار وفاكهة\n\n- [ ] طماطم\n- [ ] موز\n\n## ألبان\n\n- [ ] حليب\n- [ ] بيض\n\n## المنزل\n\n- [ ] صابون\n`,
    },
  },
  {
    id: 'checklist',
    name: { en: 'Checklist', ar: 'قائمة مهام' },
    title: 'Checklist',
    body: {
      en: `---\nview: checklist\n---\n\n## To do\n\n- [ ] First thing\n- [ ] Second thing\n`,
      ar: `---\nview: checklist\n---\n\n## للتنفيذ\n\n- [ ] أول شيء\n- [ ] ثاني شيء\n`,
    },
  },
  {
    id: 'video-board',
    name: { en: 'Video production board', ar: 'لوحة إنتاج الفيديو' },
    title: 'Videos board',
    body: {
      en: `---
kanban: pipeline
status-prop: status
card-props: [number, type, scheduled]
card-folder: Videos
---

## Ideas
- [ ] Example hardware review #hardware
  - Shooting
    - [ ] Unbox
    - [ ] Test
    - [ ] Benchmark
    - [ ] A-roll
    - [ ] B-roll
  - Post
    - [ ] Edit
    - [ ] Thumbnail
    - [ ] Description

## Scripting

## Shooting

## Post

## Scheduled

## Live
`,
      ar: `---
kanban: pipeline
status-prop: status
card-props: [number, type, scheduled]
card-folder: Videos
---

## أفكار
- [ ] مثال مراجعة جهاز #hardware
  - التصوير
    - [ ] فتح الصندوق
    - [ ] التجربة
    - [ ] اختبار الأداء
    - [ ] A-roll
    - [ ] B-roll
  - المونتاج
    - [ ] المونتاج
    - [ ] الصورة المصغرة
    - [ ] الوصف

## كتابة السيناريو

## التصوير

## المونتاج

## مجدول

## منشور
`,
    },
  },
  {
    id: 'video',
    name: { en: 'Video note', ar: 'ملاحظة فيديو' },
    title: 'Video',
    body: {
      en: `---
number: 
status: Ideas
type: review
youtube-title: 
youtube-id: 
scheduled: 
tags: [video]
---
# {{title}}

## Script

## Notes
`,
      ar: `---
number: 
status: أفكار
type: مراجعة
youtube-title: 
youtube-id: 
scheduled: 
tags: [فيديو]
---
# {{title}}

## السيناريو

## ملاحظات
`,
    },
  },
  {
    id: 'video-index',
    name: { en: 'Videos index', ar: 'فهرس الفيديوهات' },
    title: 'Videos index',
    body: {
      en: '# Videos\n\n```base\nfolder: Videos\nshow: number, status, type, scheduled, youtube-title\nsort: number desc\n```\n',
      ar: '# فهرس الفيديوهات\n\n```base\nfolder: Videos\nshow: number, status, type, scheduled, youtube-title\nsort: number desc\n```\n',
    },
  },
  {
    id: 'kanban',
    name: { en: 'Kanban board', ar: 'لوحة كانبان' },
    title: 'Board',
    body: {
      en: '---\nkanban: board\n---\n\n## To do\n- [ ] First card\n\n## Doing\n\n## Done\n',
      ar: '---\nkanban: board\n---\n\n## للتنفيذ\n- [ ] أول بطاقة\n\n## قيد العمل\n\n## تم\n',
    },
  },
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
