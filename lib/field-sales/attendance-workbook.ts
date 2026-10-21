import { strToU8, zipSync } from 'fflate';
import { localParts } from './schedule';
import type { readAttendanceMonth } from './attendance-calendar';

type Month = Awaited<ReturnType<typeof readAttendanceMonth>>;

function xml(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function textCell(ref: string, value: string) {
  return `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number) {
  return `<c r="${ref}" s="1"><v>${value}</v></c>`;
}

function localStamp(instant: string | null, timezone: string) {
  return instant ? localParts(Date.parse(instant), timezone).replace('T', ' ') : '';
}

/** Minimal Office Open XML workbook; strings are inline text, never executable formulas. */
export function attendanceWorkbook(month: Month): Uint8Array {
  const row = (index: number, cells: string[]) => `<row r="${index}">${cells.join('')}</row>`;
  const rows = [
    row(1, [textCell('A1', 'Field officer monthly attendance')]),
    row(2, [textCell('A2', 'Employee'), textCell('B2', month.employee.name)]),
    row(3, [textCell('A3', 'Month'), textCell('B3', month.month)]),
    row(4, [textCell('A4', 'Time zone'), textCell('B4', month.timezone)]),
    row(6, ['Date', 'Field officer', 'Project', 'Punch in (local)', 'Punch out (local)', 'Working hours', 'Status', 'Break hours']
      .map((heading, index) => textCell(`${'ABCDEFGH'[index]}6`, heading))),
    ...month.rows.map((day, index) => row(index + 7, [
      textCell(`A${index + 7}`, day.date),
      textCell(`B${index + 7}`, month.employee.name),
      textCell(`C${index + 7}`, day.project_names.join(', ')),
      textCell(`D${index + 7}`, localStamp(day.first_in_at, month.timezone)),
      textCell(`E${index + 7}`, day.open ? 'Still on duty' : localStamp(day.last_out_at, month.timezone)),
      numberCell(`F${index + 7}`, day.working_minutes / 60),
      textCell(`G${index + 7}`, day.status),
      numberCell(`H${index + 7}`, day.break_minutes / 60),
    ])),
  ];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="28" customWidth="1"/><col min="4" max="5" width="25" customWidth="1"/>
    <col min="6" max="8" width="17" customWidth="1"/></cols>
    <sheetData>${rows.join('')}</sheetData><autoFilter ref="A6:H${month.rows.length + 6}"/></worksheet>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      </Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="Attendance" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      </Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
      <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
      <borders count="1"><border/></borders>
      <cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>
      <cellXfs count="2"><xf numFmtId="0" xfId="0"/><xf numFmtId="2" xfId="0" applyNumberFormat="1"/></cellXfs>
      </styleSheet>`,
    'xl/worksheets/sheet1.xml': sheet,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])), { level: 6 });
}
