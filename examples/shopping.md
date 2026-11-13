# Shopping list

Qalamark works out table formulas for you, and the file stays plain Markdown.

- The **Total** column has one formula for every row: `D = B * C`.
- The **Sum** row was typed as `=SUM(B)` and `=SUM(D)` straight into the cells.

| Item    | Qty | Price |  Total |
| ------- | --: | ----: | -----: |
| Tea     |   2 |  3.50 |  $7.00 |
| Cake    |   1 |  4.25 |  $4.25 |
| Milk    |   3 |  1.20 |  $3.60 |
| **Sum** |   6 |       | $14.85 |
<!-- qalamark
D = B * C
format D = $0.00
B5 = SUM(B)
D5 = SUM(D)
-->
