import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { selectUser, fetchUserAsync } from '../redux/user/slice';

const useUser = () => {
    const user = useSelector(selectUser);
    const dispatch = useDispatch();

    useEffect(() => {
        dispatch(fetchUserAsync());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { user };
};

export default useUser;
