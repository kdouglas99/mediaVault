
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const testConnection = async () => {
  try {
    const response = await fetch(`${API_URL}/api/test`);
    const data = await response.json();
    return data;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

export const getItems = async () => {
  try {
    const response = await fetch(`${API_URL}/api/items`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API request error:', error);
    return [];
  }
};