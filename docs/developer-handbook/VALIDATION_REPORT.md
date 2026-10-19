# Handbook validation report

Generated 16 October 2026 21:49 by `validate_handbook.py`.

| Guide | PDF size | Pages | Headings found | Near-empty pages | Secret / PII hits | Missing cited paths | Result |
|---|---|---|---|---|---|---|---|
| 01_VEXON_Project_Overview | 151 KB | 13 | 24/24 | none | 0 | 0 of 91 | PASS |
| 02_JavaScript_TypeScript_React_Guide | 155 KB | 14 | 30/30 | none | 0 | 0 of 40 | PASS |
| 03_Node_Express_Backend_Guide | 147 KB | 12 | 22/22 | none | 0 | 0 of 74 | PASS |
| 04_Database_MongoDB_PostgreSQL_Guide | 141 KB | 11 | 21/21 | none | 0 | 0 of 48 | PASS |
| 05_VEXON_Feature_By_Feature_Guide | 135 KB | 13 | 26/26 | none | 0 | 0 of 223 | PASS |
| 06_Debugging_and_Error_Recovery_Guide | 126 KB | 11 | 20/20 | none | 0 | 0 of 69 | PASS |
| 07_Testing_Git_and_Safe_Code_Changes | 137 KB | 10 | 21/21 | none | 0 | 0 of 50 | PASS |
| 08_Deployment_and_Production_Maintenance | 129 KB | 8 | 16/16 | none | 0 | 0 of 25 | PASS |
| 09_VEXON_30_Day_Learning_Workbook | 96 KB | 11 | 14/14 | none | 0 | 0 of 57 | PASS |
| 10_VEXON_Developer_Handbook | 126 KB | 8 | 13/13 | none | 0 | 0 of 69 | PASS |
| 11_Error_Messages_Troubleshooting_Guide | 247 KB | 49 | 42/42 | none | 0 | 0 of 105 | PASS |

Near-empty pages are listed for review. Contents pages and handwritten-notes pages are expected to carry little text and do not fail validation.

## Details

- 02_JavaScript_TypeScript_React_Guide: cited on purpose although not in the repository: `tsconfig.json` (documented as not existing (VEXON uses no TypeScript))
- 06_Debugging_and_Error_Recovery_Guide: cited on purpose although not in the repository: `google-services.json` (Firebase config created locally for push builds; never committed); `mobile-kotlin/local.properties` (Android SDK path file created locally; git-ignored)
- 08_Deployment_and_Production_Maintenance: cited on purpose although not in the repository: `google-services.json` (Firebase config created locally for push builds; never committed)
- 10_VEXON_Developer_Handbook: cited on purpose although not in the repository: `local.properties` (Android SDK path file created locally; git-ignored)
- 11_Error_Messages_Troubleshooting_Guide: cited on purpose although not in the repository: `google-services.json` (Firebase config created locally for push builds; never committed)
