/**
 * exportUtils.js — Shared Excel export logic for Bills
 *
 * Used by Dashboard.jsx and ReportsPage.jsx.
 * Single source of truth — fix here, fixed everywhere.
 */

import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import api from '../services/api';

export const EXPORT_HEADERS = [
  'Bill No', 'Bill Date', 'Due Date', 'Company', 'Client',
  'Invoice Amount', 'Total Paid', 'Balance', 'Bill Status', 'Payment Status',
  'Payment Date', 'Payment Amount', 'Payment Mode',
  'UTR / Ref No', 'Cheque No', 'Collected By',
  'Received In Bank', 'Account Holder', 'Account Number',
  'Write-off Amount', 'Write-off Date', 'Write-off Notes',
];

export const EXPORT_COL_WIDTHS = [
  { wch: 16 }, // Bill No
  { wch: 12 }, // Bill Date
  { wch: 12 }, // Due Date
  { wch: 22 }, // Company
  { wch: 26 }, // Client
  { wch: 14 }, // Invoice Amount
  { wch: 12 }, // Total Paid
  { wch: 12 }, // Balance
  { wch: 12 }, // Bill Status
  { wch: 14 }, // Payment Status
  { wch: 12 }, // Payment Date
  { wch: 14 }, // Payment Amount
  { wch: 12 }, // Mode
  { wch: 20 }, // UTR
  { wch: 14 }, // Cheque
  { wch: 20 }, // Collected By
  { wch: 22 }, // Received In Bank
  { wch: 22 }, // Account Holder
  { wch: 20 }, // Account Number
  { wch: 16 }, // Write-off Amount
  { wch: 14 }, // Write-off Date
  { wch: 28 }, // Write-off Notes
];

/**
 * Convert a bills array to worksheet rows.
 */
export const billsToRows = (billList) => {
  const rows = [];
  billList.forEach(bill => {
    const writeoffAmt = parseFloat(bill.writeoff_amount || 0);
    const base = [
      bill.bill_no,
      bill.bill_date    ? new Date(bill.bill_date)    : '',
      bill.due_date     ? new Date(bill.due_date)     : '',
      bill.company_name || '',
      bill.client_name  || '',
      parseFloat(bill.total_invoice_value) || 0,
      parseFloat(bill.total_paid || 0),
      parseFloat(bill.balance)   || 0,
      bill.status,
      bill.payment_status || 'UNPAID',
    ];
    const writeoffCols = [
      writeoffAmt > 0 ? writeoffAmt : '',
      writeoffAmt > 0 && bill.writeoff_date ? new Date(bill.writeoff_date) : '',
      bill.writeoff_notes || '',
    ];

    if (bill.payments && bill.payments.length > 0) {
      bill.payments.forEach((pmt, idx) => {
        rows.push([
          ...base,
          pmt.payment_date ? new Date(pmt.payment_date) : '',
          parseFloat(pmt.amount_paid) || 0,
          pmt.payment_mode              || '',
          pmt.utr                       || '',
          pmt.cheque_no                 || '',
          pmt.cash_collected_by         || '',
          pmt.received_in_bank          || '',
          pmt.received_account_holder   || '',
          pmt.received_account_number   || '',
          // Show write-off only on first payment row to avoid repetition
          ...(idx === 0 ? writeoffCols : ['', '', '']),
        ]);
      });
    } else {
      rows.push([...base, '', '', '', '', '', '', '', '', '', ...writeoffCols]);
    }
  });
  return rows;
};

/**
 * Apply date and number formatting to a worksheet.
 */
const applyFormatting = (sheet) => {
  const dateFmt = 'dd/mm/yyyy';
  const numFmt  = '#,##0.00';
  const dateColIndices = [1, 2, 10, 20];   // Bill Date, Due Date, Pmt Date, Write-off Date
  const amtColIndices  = [5, 6, 7, 11, 19]; // Invoice, Paid, Balance, Pmt Amount, Write-off Amt

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (let R = 1; R <= range.e.r; R++) {
    dateColIndices.forEach(C => {
      const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === 'd') cell.z = dateFmt;
    });
    amtColIndices.forEach(C => {
      const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === 'n') cell.z = numFmt;
    });
  }

  // Bold + coloured header row
  for (let C = 0; C < EXPORT_HEADERS.length; C++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (cell) {
      cell.s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4F46E5' } },
      };
    }
  }
};

/**
 * Main export function — call this from any page.
 *
 * @param {Object} params  - Query params forwarded to /reports/export-bills
 * @param {string} [filename] - Optional custom filename (defaults to date-stamped)
 */
export const exportBillsToExcel = async (params = {}, filename = null) => {
  try {
    const response = await api.get('/reports/export-bills', { params });
    const { bills, absorbed_bills, totals } = response.data.data;

    // ── Main Bills sheet ────────────────────────────────────────────────
    const mainRows  = billsToRows(bills);
    const totalsRow = [
      'TOTAL', '', '', '', '',
      totals.total_billed, totals.total_paid, totals.total_balance,
      '', '', '', '', '', '', '', '', '', '', '',
      totals.total_writeoff || 0, '', '',
    ];
    const mainData  = [EXPORT_HEADERS, ...mainRows, totalsRow];
    const mainSheet = XLSX.utils.aoa_to_sheet(mainData);
    mainSheet['!cols'] = EXPORT_COL_WIDTHS;
    applyFormatting(mainSheet);

    // ── Absorbed Bills sheet ────────────────────────────────────────────
    const absorbedRows  = billsToRows(absorbed_bills || []);
    const absorbedData  = [
      EXPORT_HEADERS,
      ...(absorbedRows.length ? absorbedRows : [['No absorbed bills in this period']]),
    ];
    const absorbedSheet = XLSX.utils.aoa_to_sheet(absorbedData);
    absorbedSheet['!cols'] = EXPORT_COL_WIDTHS;

    // ── Assemble workbook ───────────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, mainSheet,     'Bills');
    XLSX.utils.book_append_sheet(wb, absorbedSheet, 'Absorbed Bills');

    const outFile = filename || `bills-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, outFile);

    toast.success('Exported successfully');
  } catch (error) {
    console.error('Export error:', error);
    toast.error('Failed to export data');
  }
};
