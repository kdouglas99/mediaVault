const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface MediaItem {
  id: number;
  external_id: string;
  title: string;
  series_title?: string;
  season_number?: number;
  episode_number?: number;
  content_type?: string;
  availability_state?: string;
  countries?: string[];
  premium_features?: string[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export const testConnection = async () => {
  try {
    const response = await fetch(`${API_URL}/api/test`);
    const data = await response.json();
    return data;
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Network error' 
    };
  }
};

export const getItems = async (params = {}) => {
  try {
    const searchParams = new URLSearchParams(params);
    const response = await fetch(`${API_URL}/api/items?${searchParams}`);
    const data = await response.json();
    return data.success ? data.data : [];
  } catch (error) {
    console.error('API request error:', error);
    return [];
  }
};

export const getStats = async () => {
  try {
    const response = await fetch(`${API_URL}/api/stats`);
    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    console.error('Stats API error:', error);
    return null;
  }
};

export const importCSV = async (file: File) => {
  try {
    const formData = new FormData();
    formData.append('csvFile', file);
    
    const response = await fetch(`${API_URL}/api/import/csv`, {
      method: 'POST',
      body: formData,
    });
    
    return await response.json();
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Import failed' 
    };
  }
};

export const initializeDatabase = async () => {
  try {
    const response = await fetch(`${API_URL}/api/init-db`, {
      method: 'POST',
    });
    
    return await response.json();
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Database initialization failed' 
    };
  }
}