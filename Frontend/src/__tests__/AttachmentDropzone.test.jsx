import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentDropzone, validateFile, formatBytes, MAX_FILE_SIZE_BYTES } from '../components/AttachmentDropzone';

describe('AttachmentDropzone Validation & UI', () => {
    describe('validateFile logic', () => {
        it('accepts files within 10MB limit and valid extension', () => {
            const validFile = new File(['dummy content'], 'report.pdf', { type: 'application/pdf' });
            Object.defineProperty(validFile, 'size', { value: 2 * 1024 * 1024 }); // 2MB

            const result = validateFile(validFile);
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it('rejects files larger than 10MB', () => {
            const largeFile = new File(['dummy'], 'large_screenshot.png', { type: 'image/png' });
            Object.defineProperty(largeFile, 'size', { value: 12 * 1024 * 1024 }); // 12MB

            const result = validateFile(largeFile);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/File is too large/i);
            expect(result.error).toMatch(/10 MB/);
        });

        it('rejects unsupported file extensions', () => {
            const invalidFile = new File(['binary'], 'script.exe', { type: 'application/x-msdownload' });
            Object.defineProperty(invalidFile, 'size', { value: 500 * 1024 });

            const result = validateFile(invalidFile);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/Unsupported file type/i);
        });
    });

    describe('formatBytes helper', () => {
        it('formats bytes into KB and MB properly', () => {
            expect(formatBytes(512 * 1024)).toBe('512.0 KB');
            expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
            expect(formatBytes(0)).toBe('0.0 KB');
        });
    });

    describe('Component Interactions', () => {
        it('renders empty dropzone with drag & drop guidance', () => {
            render(<AttachmentDropzone file={null} />);
            expect(screen.getByText(/drag and drop or/i)).toBeInTheDocument();
            expect(screen.getByText(/Supports PNG, JPG, WebP, PDF, TXT, LOG \(up to 10 MB\)/i)).toBeInTheDocument();
        });

        it('displays file metadata and remove button when file is provided', () => {
            const onFileRemove = jest.fn();
            const mockFile = new File(['content'], 'system_error.log', { type: 'text/plain' });
            Object.defineProperty(mockFile, 'size', { value: 1.5 * 1024 * 1024 });

            render(
                <AttachmentDropzone
                    file={mockFile}
                    onFileRemove={onFileRemove}
                />
            );

            expect(screen.getByText('system_error.log')).toBeInTheDocument();
            expect(screen.getByText(/1.50 MB \/ 10 MB/i)).toBeInTheDocument();

            const removeBtn = screen.getByLabelText(/remove file system_error.log/i);
            fireEvent.click(removeBtn);
            expect(onFileRemove).toHaveBeenCalledTimes(1);
        });

        it('shows validation error when selecting an oversized file', () => {
            const onError = jest.fn();
            const { container } = render(<AttachmentDropzone file={null} onError={onError} />);

            const oversizedFile = new File(['big'], 'dump.log', { type: 'text/plain' });
            Object.defineProperty(oversizedFile, 'size', { value: 15 * 1024 * 1024 }); // 15MB

            const input = container.querySelector('input[type="file"]');
            fireEvent.change(input, { target: { files: [oversizedFile] } });

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText(/File is too large/i)).toBeInTheDocument();
            expect(onError).toHaveBeenCalledWith(expect.stringMatching(/File is too large/i));
        });
    });
});
