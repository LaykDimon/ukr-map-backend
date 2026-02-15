import { EtagInterceptor } from './etag.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { createHash } from 'crypto';

describe('EtagInterceptor', () => {
  let interceptor: EtagInterceptor;

  beforeEach(() => {
    interceptor = new EtagInterceptor();
  });

  it('should set ETag header on GET responses', (done) => {
    const body = { id: 1, name: 'test' };
    const json = JSON.stringify(body);
    const expectedHash = createHash('md5').update(json).digest('hex');
    const expectedEtag = `"${expectedHash}"`;

    const mockResponse = {
      setHeader: jest.fn(),
      status: jest.fn(),
    };
    const mockRequest = {
      method: 'GET',
      headers: {},
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = { handle: () => of(body) };

    interceptor.intercept(context, next).subscribe((result) => {
      expect(mockResponse.setHeader).toHaveBeenCalledWith('ETag', expectedEtag);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache',
      );
      expect(result).toEqual(body);
      done();
    });
  });

  it('should return 304 when If-None-Match matches ETag', (done) => {
    const body = { id: 1, name: 'test' };
    const json = JSON.stringify(body);
    const hash = createHash('md5').update(json).digest('hex');
    const etag = `"${hash}"`;

    const mockResponse = {
      setHeader: jest.fn(),
      status: jest.fn(),
    };
    const mockRequest = {
      method: 'GET',
      headers: { 'if-none-match': etag },
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = { handle: () => of(body) };

    interceptor.intercept(context, next).subscribe((result) => {
      expect(mockResponse.status).toHaveBeenCalledWith(304);
      expect(result).toBeUndefined();
      done();
    });
  });

  it('should not apply to non-GET requests', (done) => {
    const body = { created: true };
    const mockResponse = {
      setHeader: jest.fn(),
      status: jest.fn(),
    };
    const mockRequest = {
      method: 'POST',
      headers: {},
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = { handle: () => of(body) };

    interceptor.intercept(context, next).subscribe((result) => {
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
      expect(result).toEqual(body);
      done();
    });
  });
});
