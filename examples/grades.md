# Class grades

Functions (`ROUND`, `IF`, `AVG`) and several formats in one table.

| Student           | Math | Science | English | Average | Result |
| ----------------- | ---: | ------: | ------: | ------: | :----: |
| Lina              |   88 |      92 |      79 |    86.3 |  Pass  |
| Omar              |   54 |      61 |      70 |    61.7 |  Pass  |
| Sara              |   95 |      98 |      91 |    94.7 |  Pass  |
| **Class average** | 79.0 |    83.7 |    80.0 |    80.9 |        |
<!-- qalamark
// one formula per column, applied to every student
E = ROUND((B + C + D) / 3, 1)
F = IF(E >= 60, "Pass", "Fail")
format E = 0.0
format B5 = 0.0; format C5 = 0.0; format D5 = 0.0
B5 = AVG(B)
C5 = AVG(C)
D5 = AVG(D)
E5 = AVG(E)
-->
