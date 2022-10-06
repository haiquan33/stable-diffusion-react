import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { fetchUser } from './api';

const initialState = {
    user: null,
    status: 'idle',
};

export const fetchUserAsync = createAsyncThunk('user/fetchUser', async () => {
    const response = await fetchUser();
    return response.data;
});

export const userSlice = createSlice({
    name: 'user',
    initialState,

    reducers: {
        setUser: (state, action) => {
            state.user = action.payload;
        },
    },

    extraReducers: (builder) => {
        builder
            .addCase(fetchUserAsync.pending, (state) => {
                state.status = 'loading';
            })
            .addCase(fetchUserAsync.fulfilled, (state, action) => {
                state.status = 'idle';
                state.user = action.payload;
            });
    },
});

export const { setUser } = userSlice.actions;

export const selectUser = (state) => state.user.user;

export default userSlice.reducer;
