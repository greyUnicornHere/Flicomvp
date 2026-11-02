import { describe, expect, it } from 'vitest';
import { suggestedAnswers } from './service.js';

describe('suggested answers to interview questions', () => {
  it('keeps at most four short, distinct choices', () => {
    expect(suggestedAnswers(['From the ERP.', 'from the erp', 'Email', 'Spreadsheet', 'Paper', 'Phone'], '')).toEqual(['From the ERP', 'Email', 'Spreadsheet', 'Paper']);
  });

  it('drops a choice with figures the workflow or the person did not give', () => {
    expect(suggestedAnswers(['Within 2%', 'Within 5%', 'No tolerance'], 'a tolerance of 2% applies')).toEqual(['Within 2%', 'No tolerance']);
  });

  it('shortens long choices and skips empty ones', () => {
    const [long] = suggestedAnswers(['  ', 'A person in finance checks every single invoice by hand before payment goes out'], '');
    expect(long!.split(' ').length).toBeLessThanOrEqual(11);
  });
});
