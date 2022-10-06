export function fetchUser() {
    return new Promise((resolve) => setTimeout(() => resolve({ data: { id: 0 } }), 500));
}
