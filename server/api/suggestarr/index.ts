import ExternalAPI from '@server/api/externalapi';
import logger from '@server/logger';

export interface SuggestarrItem {
  id: number;
  tmdb_id: string;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  rating?: number;
  release_date?: string;
  status:
    | 'awaiting_approval'
    | 'queued'
    | 'submitting'
    | 'submitted'
    | 'rejected'
    | 'failed'
    | 'blacklisted';
}

export interface SuggestarrListResponse {
  data: SuggestarrItem[];
  meta: {
    page: number;
    pages: number;
    per_page: number;
    total: number;
  };
}

class SuggestarrAPI extends ExternalAPI {
  private static getBaseUrl(): string {
    if (process.env.SUGGESTARR_URL) {
      return process.env.SUGGESTARR_URL;
    }
    // In Docker environment, suggestarr container is reachable at http://suggestarr:5000
    // If running on host, fallback to http://localhost:4455
    return process.env.NODE_ENV === 'production'
      ? 'http://suggestarr:5000'
      : 'http://localhost:4455';
  }

  constructor() {
    super(
      SuggestarrAPI.getBaseUrl(),
      {},
      {
        timeout: 10000,
      }
    );
  }

  public async getStatus(): Promise<{ status: string; api_version: string } | null> {
    try {
      const resp = await this.get<{ data: { status: string; api_version: string } }>(
        '/api/v1/status'
      );
      return resp.data;
    } catch (e) {
      // Try fallback url if first attempt failed
      try {
        const fallback = 'http://localhost:4455';
        const resp = await this.axios.get<{ data: { status: string; api_version: string } }>(
          `${fallback}/api/v1/status`,
          { timeout: 3000 }
        );
        return resp.data.data;
      } catch {
        logger.debug('Suggestarr service is currently unreachable', {
          label: 'SuggestarrAPI',
          error: e.message,
        });
        return null;
      }
    }
  }

  public async getSuggestions(options: {
    page?: number;
    perPage?: number;
    status?: string;
    mediaType?: string;
  } = {}): Promise<SuggestarrListResponse> {
    const params = {
      page: options.page ?? 1,
      per_page: options.perPage ?? 25,
      status: options.status ?? 'all',
      media_type: options.mediaType ?? 'all',
    };

    try {
      return await this.get<SuggestarrListResponse>('/api/v1/suggestions', {
        params,
      });
    } catch (e) {
      try {
        const fallback = 'http://localhost:4455';
        const resp = await this.axios.get<SuggestarrListResponse>(
          `${fallback}/api/v1/suggestions`,
          { params, timeout: 5000 }
        );
        return resp.data;
      } catch {
        logger.debug('Failed to fetch suggestions from Suggestarr', {
          label: 'SuggestarrAPI',
          error: e.message,
        });
        return {
          data: [],
          meta: { page: 1, pages: 1, per_page: 25, total: 0 },
        };
      }
    }
  }

  public async getJobPreview(jobId = 1): Promise<SuggestarrItem[]> {
    try {
      const resp = await this.post<{ data: { items: SuggestarrItem[] } }>(
        `/api/v1/jobs/${jobId}/preview`,
        {}
      );
      return resp.data.items || [];
    } catch (e) {
      try {
        const fallback = 'http://localhost:4455';
        const resp = await this.axios.post<{ data: { items: SuggestarrItem[] } }>(
          `${fallback}/api/v1/jobs/${jobId}/preview`,
          {},
          { timeout: 15000 }
        );
        return resp.data.data?.items || [];
      } catch {
        logger.debug('Failed to preview Suggestarr job', {
          label: 'SuggestarrAPI',
          jobId,
          error: e.message,
        });
        return [];
      }
    }
  }

  public async triggerJobRun(jobId = 1): Promise<boolean> {
    try {
      await this.post(`/api/v1/jobs/${jobId}/runs`, {});
      return true;
    } catch (e) {
      try {
        const fallback = 'http://localhost:4455';
        await this.axios.post(`${fallback}/api/v1/jobs/${jobId}/runs`, {}, { timeout: 5000 });
        return true;
      } catch {
        logger.debug('Failed to trigger Suggestarr job run', {
          label: 'SuggestarrAPI',
          jobId,
          error: e.message,
        });
        return false;
      }
    }
  }
}

export default SuggestarrAPI;
