import { extractRetryError } from '../helpers/extractRetryError';

describe('extractRetryError', () => {
  it('should return an empty object for null', () => {
    expect(extractRetryError(null)).toEqual({});
  });

  it('should return an empty object for undefined', () => {
    expect(extractRetryError(undefined)).toEqual({});
  });

  it('should return message for a plain string', () => {
    expect(extractRetryError('something went wrong')).toEqual({
      message: 'something went wrong'
    });
  });

  it('should extract message from a standard Error', () => {
    const err = new Error('connection refused');
    const result = extractRetryError(err);
    expect(result.message).toBe('connection refused');
    expect(result.originalError).toBe(err);
  });

  it('should extract statusCode and message from an Axios-style error', () => {
    const axiosError = {
      message: 'Request failed with status code 503',
      response: {
        status: 503,
        data: { error: 'Service Unavailable' }
      }
    };

    const result = extractRetryError(axiosError);
    expect(result.statusCode).toBe(503);
    expect(result.message).toBe('Request failed with status code 503');
    expect(result.originalError).toBe(axiosError);
  });

  it('should return only message when response is absent', () => {
    const error = { message: 'Network Error' };
    const result = extractRetryError(error);
    expect(result.statusCode).toBeUndefined();
    expect(result.message).toBe('Network Error');
  });

  it('should return originalError for non-object, non-string types', () => {
    const result = extractRetryError(42);
    expect(result.originalError).toBe(42);
  });

  it('should handle objects with numeric response.status', () => {
    const error = { response: { status: 500 }, message: 'Internal Server Error' };
    const result = extractRetryError(error);
    expect(result.statusCode).toBe(500);
  });

  it('should ignore non-numeric response.status', () => {
    const error = { response: { status: 'five-hundred' }, message: 'Bad' };
    const result = extractRetryError(error);
    expect(result.statusCode).toBeUndefined();
  });
});
