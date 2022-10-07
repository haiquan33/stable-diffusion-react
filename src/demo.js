import { Button, Input } from "antd";
import { useState } from "react";
import { useProcessPromt } from "./hook/useProcessPromt";

export const DemoApp = () => {
    const [previewImg, setPreviewImg] = useState({ src: '' });
    const [promt, setPromt] = useState('')

    const { makeImage, result } = useProcessPromt({ config: { promptField: promt } })
    console.log(result)
    return <div>
        <div className="w-1/2">
            <div className="flex">
                <Input value={promt} onChange={e => setPromt(e.target.value)} />
                <Button onClick={makeImage}>Make image</Button>
            </div>
            {result.src && <img src={result.src} alt="preview" />}

        </div>

    </div>;
};
