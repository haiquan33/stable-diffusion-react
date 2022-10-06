import logo from './logo.svg';
import './App.css';
import 'antd/dist/antd.css';
import { Button } from 'antd';
import useUser from './hook/useUser';
import { DemoApp } from './demo';

function App() {
    const { user } = useUser();
    return (
        <div className="App">
            <DemoApp />
        </div>
    );
}

export default App;
