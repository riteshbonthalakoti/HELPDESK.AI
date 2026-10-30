import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('ErrorBoundary.jsx exists and exports a valid ErrorBoundary component', () => {
    const errorBoundaryPath = path.resolve(__dirname, '../src/components/ErrorBoundary.jsx');
    assert.strictEqual(fs.existsSync(errorBoundaryPath), true);
    const content = fs.readFileSync(errorBoundaryPath, 'utf8');
    assert.ok(content.includes('class ErrorBoundary extends React.Component'));
    assert.ok(content.includes('export default ErrorBoundary'));
});

test('ErrorBoundary provides Diagnostic Copy, Try Again, and Return to Dashboard actions', () => {
    const errorBoundaryPath = path.resolve(__dirname, '../src/components/ErrorBoundary.jsx');
    const content = fs.readFileSync(errorBoundaryPath, 'utf8');
    assert.ok(content.includes('Copy Payload'));
    assert.ok(content.includes('Try Again'));
    assert.ok(content.includes('Return to Dashboard'));
});

test('TicketDetailView.jsx imports ErrorBoundary and wraps the view safely', () => {
    const ticketDetailPath = path.resolve(__dirname, '../src/pages/TicketDetailView.jsx');
    assert.strictEqual(fs.existsSync(ticketDetailPath), true);
    const content = fs.readFileSync(ticketDetailPath, 'utf8');
    assert.ok(content.includes("import ErrorBoundary from '../components/ErrorBoundary'"));
    assert.ok(content.includes('<ErrorBoundary>'));
    assert.ok(content.includes('</ErrorBoundary>'));
    assert.ok(content.includes('TicketDetailViewContent'));
});
