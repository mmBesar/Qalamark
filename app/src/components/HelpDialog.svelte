<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 mmBesar -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte.ts';

  let { onClose }: { onClose: () => void } = $props();
  let dlg: HTMLDialogElement;
  const ar = store.lang === 'ar';
  onMount(() => dlg.showModal());
</script>

<dialog bind:this={dlg} onclose={onClose} class="wide help">
  <form method="dialog" class="dialog-head">
    <h2>ƒ {ar ? 'حسابات الجداول' : 'Table math'}</h2>
    <button class="icon" aria-label={store.t('close')}>×</button>
  </form>

  {#if ar}
    <h3>الطريقة الأسهل</h3>
    <p>اضغط على أي خانة في الجدول واكتب <code>=</code> ثم المعادلة، واضغط <kbd>Tab</kbd> أو <kbd>Enter</kbd>. تظهر النتيجة في الخانة، وتُحفظ المعادلة تحت الجدول.</p>
    <table>
      <tbody>
        <tr><td><code>=B2*C2</code></td><td>معادلة لخانة واحدة</td></tr>
        <tr><td><code>==B*C</code></td><td>معادلة لكل صفوف العمود (علامتا <code>=</code>)</td></tr>
        <tr><td><code>=SUM(D)</code></td><td>مجموع العمود D كله (فوق هذه الخانة)</td></tr>
        <tr><td><code>=SUM(B2:B5)</code></td><td>مجموع نطاق</td></tr>
        <tr><td><code>=[Price]*[Qty]</code></td><td>الأعمدة بأسماء العناوين</td></tr>
        <tr><td><code>=ROUND(B2/3, 2)</code></td><td>دوال: <code>SUM AVG MIN MAX COUNT ROUND IF ABS SQRT MOD ...</code></td></tr>
      </tbody>
    </table>
    <h3>مثال</h3>
    <h3>معادلات بكلمات بسيطة</h3>
    <table>
      <tbody>
        <tr><td><code>D = B * C</code></td><td>اضرب عمودين صفًّا بصف</td></tr>
        <tr><td><code>D = change in C</code></td><td>الفرق عن الصف السابق (صفر في الصف الأول)</td></tr>
        <tr><td><code>C = days since previous B</code></td><td>تواريخ مثل 2022-04-01 (وأيضًا <code>hours</code> و<code>minutes</code>)</td></tr>
        <tr><td><code>D in last row = total of D</code></td><td>الصف الأخير يجمع العمود (وأيضًا <code>average of</code> و<code>highest</code> و<code>lowest</code>)</td></tr>
      </tbody>
    </table>
    <p>لا حاجة لكتابتها: اضغط <b>ƒ</b> تحت الجدول واختر من القوائم.</p>
    <p>اكتب في خانة <b>Total</b> الأولى: <code>==B*C</code>، وفي خانة المجموع: <code>=SUM(D)</code>.</p>
    <h3>ملاحظات</h3>
    <ul>
      <li>الصف الأول هو العناوين، والبيانات تبدأ من الصف 2. الأعمدة A و B و C من اليسار.</li>
      <li>الخانات المحسوبة ملونة. اضغط عليها لترى معادلتها. لحذف معادلة، عدّلها في صندوق <b>ƒ</b> تحت الجدول.</li>
      <li>الأخطاء تظهر في الخانة مثل <code>#DIV/0!</code> مع شرح تحت الجدول.</li>
      <li>الملف يبقى ماركداون عاديًا: النتائج في الخانات، والمعادلات داخل تعليق <code>&lt;!-- qalamark --&gt;</code> لا يراه غيرك.</li>
    </ul>
  {:else}
    <h3>The easy way</h3>
    <p>Click any cell in a table, type <code>=</code> and a formula, then press <kbd>Tab</kbd> or <kbd>Enter</kbd>. The result appears in the cell and the formula is kept under the table.</p>
    <table>
      <tbody>
        <tr><td><code>=B2*C2</code></td><td>a formula for this one cell</td></tr>
        <tr><td><code>==B*C</code></td><td>a formula for every row of this column (two <code>=</code>)</td></tr>
        <tr><td><code>=SUM(D)</code></td><td>total of the whole column D (the rows above this cell)</td></tr>
        <tr><td><code>=SUM(B2:B5)</code></td><td>total of a range</td></tr>
        <tr><td><code>=[Price]*[Qty]</code></td><td>columns by their header name</td></tr>
        <tr><td><code>=ROUND(B2/3, 2)</code></td><td>functions: <code>SUM AVG MIN MAX COUNT ROUND IF ABS SQRT MOD ...</code></td></tr>
      </tbody>
    </table>
    <h3>Example</h3>
    <h3>Plain-words formulas</h3>
    <table>
      <tbody>
        <tr><td><code>D = B * C</code></td><td>multiply two columns, row by row</td></tr>
        <tr><td><code>D = change in C</code></td><td>this row minus the row above (0 on the first row)</td></tr>
        <tr><td><code>C = days since previous B</code></td><td>dates like 2022-04-01 (also <code>hours</code>, <code>minutes</code>; or <code>days between B and C</code>)</td></tr>
        <tr><td><code>D in last row = total of D</code></td><td>the bottom row adds the column up (also <code>average of</code>, <code>highest</code>, <code>lowest</code>, <code>count of</code>)</td></tr>
      </tbody>
    </table>
    <p>No need to type any of it: press <b>ƒ</b> under the table and pick from the lists.</p>
    <p>In the first <b>Total</b> cell type <code>==B*C</code>, and in the bottom cell of that column type <code>=SUM(D)</code>.</p>
    <h3>Good to know</h3>
    <ul>
      <li>Row 1 is the header; data starts at row 2. Columns are A, B, C… from the left.</li>
      <li>Calculated cells are tinted. Click one to see its formula. To remove a formula, edit it in the <b>ƒ</b> box under the table.</li>
      <li>Mistakes show in the cell (like <code>#DIV/0!</code>) with an explanation under the table.</li>
      <li>The file stays normal Markdown: results are in the cells and the formulas sit in a <code>&lt;!-- qalamark --&gt;</code> comment that other apps ignore.</li>
    </ul>
  {/if}
  <p class="muted tiny">docs/TABLE-FORMULAS.md</p>
</dialog>
