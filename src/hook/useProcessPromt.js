import { useEffect, useRef, useState } from 'react';
import { API_PATH, IMAGE_REGEX, MAX_INIT_IMAGE_DIMENSION } from '../const';

export const useProcessPromt = ({ config }) => {
    const [taskQueue, setTaskQueue] = useState([]);

    const [status, setStatus] = useState();
    const [isProcessing, setIsProcessing] = useState(false);
    const [processPercent, setProcessPercent] = useState(0);
    const [msg, setMsg] = useState({ status: '', msg: '' });
    const [result, setResult] = useState({});
    const [serverStatus, setServerStatus] = useState('online');
    const currentTask = useRef(null);

    const {
        randomSeed = true,
        seedField = 1,
        numOutputsTotalField = 1,
        numOutputsParallelField = 1,
        streamImageProgressField,
        promptField,
        negativePromptField = '',
        guidanceScaleField = 7.5,
        numInferenceStepsField = 50,
        widthField = 512,
        heightField = 512,
        turboField = true,
        useCPUField = false,
        useFullPrecisionField = false,
        showOnlyFilteredImageField,
        initImagePreview = '',
        promptStrengthField = 80,
        samplerField = 'plms',
        saveToDisk = false,
        diskPathField,
        useFaceCorrectionField = false,
        useUpscalingField = false,
        upscaleModelField = 'RealESRGAN_x4plus',
    } = config;

    const handleStatus = (statusType, msg, msgType) => {
        if (statusType !== 'server') {
            return;
        }

        if (msgType === 'error') {
            setStatus({ color: 'red', msg: 'Stable Diffusion has stopped' });
        } else if (msgType === 'success') {
            setStatus({ color: 'green', msg: 'Stable Diffusion is ready' });
        }
    };

    const handleMsg = (status, msg) => {
        setMsg({ status, msg });
    };

    useEffect(() => {
        async function checkTasks() {
            const newTaskQueu = [...taskQueue];
            if (newTaskQueu.length === 0) {
                setStatus('request', 'done', 'success');
                return;
            }

            handleStatus('request', 'fetching..');
            setIsProcessing(true);

            currentTask.current = newTaskQueu.pop();
            let time = new Date().getTime();

            let successCount = 0;

            currentTask.current.isProcessing = true;

            for (let i = 0; i < currentTask.current.batchCount; i++) {
                currentTask.current.reqBody['seed'] = currentTask.current.seed + i * currentTask.current.reqBody['num_outputs'];

                let success = await doMakeImage(currentTask.current);
                currentTask.current.batchesDone++;

                if (!currentTask.current?.isProcessing) {
                    break;
                }

                if (success) {
                    successCount++;
                }
            }

            time = new Date().getTime() - time;
            time /= 1000;
            setIsProcessing(false);
            setTaskQueue(newTaskQueu);
        }
        checkTasks();
    }, [taskQueue]);

    const doMakeImage = async (task) => {
        if (task.stopped) {
            return;
        }

        const reqBody = task.reqBody;
        const batchCount = task.batchCount;
        let res = '';
        let seed = reqBody['seed'];
        let numOutputs = parseInt(reqBody['num_outputs']);

        let images = [];

        try {
            res = await fetch(`${API_PATH}/image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(reqBody),
            });

            let reader = res.body.getReader();
            let textDecoder = new TextDecoder();
            let finalJSON = '';
            let prevTime = -1;
            let stepsRemaining = 0;
            let timeRemaining = 0;
            while (true) {
                try {
                    let t = new Date().getTime();

                    const { value, done } = await reader.read();
                    if (done) {
                        break;
                    }

                    let timeTaken = prevTime === -1 ? -1 : t - prevTime;

                    let jsonStr = textDecoder.decode(value);

                    try {
                        let stepUpdate = JSON.parse(jsonStr);

                        if (stepUpdate.step === undefined) {
                            finalJSON += jsonStr;
                        } else {
                            let batchSize = stepUpdate.total_steps;
                            let overallStepCount = stepUpdate.step + task.batchesDone * batchSize;
                            let totalSteps = batchCount * batchSize;
                            let percent = 100 * (overallStepCount / totalSteps);
                            percent = percent > 100 ? 100 : percent;
                            percent = percent.toFixed(0);

                            stepsRemaining = totalSteps - overallStepCount;
                            stepsRemaining = stepsRemaining < 0 ? 0 : stepsRemaining;
                            timeRemaining = timeTaken === -1 ? 0 : stepsRemaining * timeTaken; // ms
                            setProcessPercent(percent);
                        }
                    } catch (e) {
                        finalJSON += jsonStr;
                    }

                    prevTime = t;
                } catch (e) {
                    handleMsg('error', 'Stable Diffusion had an error. Please check the logs in the command-line window.');
                    res = undefined;
                    throw e;
                }
            }

            if (res.status !== 200) {
                if (serverStatus === 'online') {
                    handleMsg('error', 'Stable Diffusion had an error: ' + (await res.text()), res);
                } else {
                    handleMsg(
                        'error',
                        'Stable Diffusion is still starting up, please wait. If this goes on beyond a few minutes, Stable Diffusion has probably crashed. Please check the error message in the command-line window.'
                    );
                }
                res = undefined;
                setIsProcessing(false);
                setProcessPercent(0);
            } else {
                if (finalJSON !== undefined && finalJSON.indexOf('}{') !== -1) {
                    // hack for a middleman buffering all the streaming updates, and unleashing them
                    //  on the poor browser in one shot.
                    //  this results in having to parse JSON like {"step": 1}{"step": 2}...{"status": "succeeded"..}
                    //  which is obviously invalid.
                    // So we need to just extract the last {} section, starting from "status" to the end of the response

                    let lastChunkIdx = finalJSON.lastIndexOf('}{');
                    if (lastChunkIdx !== -1) {
                        let remaining = finalJSON.substring(lastChunkIdx);
                        finalJSON = remaining.substring(1);
                    }
                }

                res = JSON.parse(finalJSON);

                if (res.status !== 'succeeded') {
                    let msg = '';
                    if (res.detail !== undefined) {
                        msg = res.detail;

                        if (msg.toLowerCase().includes('out of memory')) {
                            msg += `<br/><br/>
                                  <b>Suggestions</b>:
                                  <br/>
                                  1. If you have set an initial image, please try reducing its dimension to ${MAX_INIT_IMAGE_DIMENSION}x${MAX_INIT_IMAGE_DIMENSION} or smaller.<br/>
                                  2. Try disabling the '<em>Turbo mode</em>' under '<em>Advanced Settings</em>'.<br/>
                                  3. Try generating a smaller image.<br/>`;
                        }
                    } else {
                        msg = res;
                    }
                    handleMsg('error', msg);
                    res = undefined;
                }
            }
        } catch (e) {
            console.log('request error', e);
            handleMsg(
                'error',
                'Stable Diffusion had an error. Please check the logs in the command-line window. <br/><br/>' +
                e +
                '<br/><pre>' +
                e.stack +
                '</pre>'
            );
            handleStatus('request', 'error', 'error');
            setIsProcessing(false);
            res = undefined;
        }

        if (!res) {
            return false;
        }

        for (let idx in res.output) {
            let imgBody = '';
            let seed = 0;

            try {
                let imgData = res.output[idx];
                imgBody = imgData.data;
                seed = imgData.seed;
            } catch (e) {
                console.log(imgBody);
                setStatus('request', 'invalid image', 'error');
                continue;
            }

            setResult({ src: imgBody });
        }

        return true;
    };

    async function makeImage() {
        const newTaskQueue = [...taskQueue];
        let task = {
            stopped: false,
            batchesDone: 0,
        };

        let sessionId = new Date().getTime();

        let seed = randomSeed ? Math.floor(Math.random() * 10000000) : parseInt(seedField);
        let numOutputsTotal = parseInt(numOutputsTotalField);
        let numOutputsParallel = parseInt(numOutputsParallelField);
        let batchCount = Math.ceil(numOutputsTotal / numOutputsParallel);
        let batchSize = numOutputsParallel;

        let streamImageProgress = numOutputsTotal > 50 ? false : streamImageProgressField;
        let prompt = promptField;

        let reqBody = {
            session_id: sessionId,
            prompt: prompt,
            negative_prompt: negativePromptField.trim(),
            num_outputs: batchSize,
            num_inference_steps: numInferenceStepsField,
            guidance_scale: guidanceScaleField,
            width: widthField,
            height: heightField,
            allow_nsfw: true,
            turbo: turboField,
            use_cpu: useCPUField,
            use_full_precision: useFullPrecisionField,
            stream_progress_updates: true,
            stream_image_progress: streamImageProgress,
            show_only_filtered_image: showOnlyFilteredImageField,
            promptStrengthField,
        };

        if (IMAGE_REGEX.test(initImagePreview)) {
            reqBody['init_image'] = initImagePreview;
            reqBody['prompt_strength'] = promptStrengthField;

            // if (IMAGE_REGEX.test(maskImagePreview.src)) {
            //     reqBody['mask'] = maskImagePreview.src
            // }
            // if (maskSetting.checked) {
            //     reqBody['mask'] = inpaintingEditor.getImg();
            // }

            reqBody['sampler'] = 'ddim';
        } else {
            reqBody['sampler'] = samplerField;
        }

        if (saveToDisk) {
            reqBody['save_to_disk_path'] = diskPathField;
        }

        if (useFaceCorrectionField) {
            reqBody['use_face_correction'] = 'GFPGANv1.3';
        }

        if (useUpscalingField) {
            reqBody['use_upscale'] = upscaleModelField;
        }

        task['reqBody'] = reqBody;
        task['seed'] = seed;
        task['batchCount'] = batchCount;
        task['isProcessing'] = false;

        let taskEntry = document.createElement('div');

        task['numOutputsTotal'] = numOutputsTotal;

        newTaskQueue.unshift(task);
        setTaskQueue(newTaskQueue);
    }

    const stopTask = async () => {
        if (!currentTask.current) {
            return;
        }
        const { current } = currentTask;
        if (current['isProcessing']) {
            current.isProcessing = false;
            try {
                let res = await fetch(`${API_PATH}/image/stop`);
            } catch (e) {
                console.log(e);
            }
        } else {
            let newTaskQueue = [...taskQueue];
            let idx = newTaskQueue.indexOf(current);
            if (idx >= 0) {
                newTaskQueue.splice(idx, 1);
            }

            newTaskQueue.remove();
            setTaskQueue(newTaskQueue);
        }
    };

    return { makeImage, result, processPercent, isProcessing };
};
