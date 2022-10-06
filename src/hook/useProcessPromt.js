import { useEffect, useState } from 'react';
import { IMAGE_REGEX } from '../const';

export const useProcessPromt = ({ config }) => {
    const [taskQueue, setTaskQueue] = useState([]);
    const [status, setStatus] = useState();
    const [isProcessing, setIsProcessing] = useState(false);
    const [processPercent, setProcessPercent] = useState(0);
    const [msg, setMsg] = useState({ status: '', msg: '' });
    const [serverStatus, setServerStatus] = useState('online');
    const {
        randomSeed,
        seedField,
        numOutputsTotalField,
        numOutputsParallelField,
        streamImageProgressField,
        promptField,
        negativePromptField = '',
        guidanceScaleField = 75,
        numInferenceStepsField = 50,
        widthField,
        heightField,
        turboField = true,
        useCPUField = false,
        useFullPrecisionField = true,
        showOnlyFilteredImageField,
        initImagePreview,
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
            if (taskQueue.length === 0) {
                setStatus('request', 'done', 'success');
                setTimeout(checkTasks, 500);
                stopImageBtn.style.display = 'none';
                makeImageBtn.innerHTML = 'Make Image';

                currentTask = null;

                if (bellPending) {
                    if (isSoundEnabled()) {
                        playSound();
                    }
                    bellPending = false;
                }

                return;
            }

            handleStatus('request', 'fetching..');
            setIsProcessing(true);

            previewTools.style.display = 'block';

            let task = taskQueue.pop();
            currentTask = task;

            let time = new Date().getTime();

            let successCount = 0;

            task.isProcessing = true;
            task['stopTask'].innerHTML = '<i class="fa-solid fa-circle-stop"></i> Stop';
            task['taskStatusLabel'].innerText = 'Processing';
            task['taskStatusLabel'].className += ' activeTaskLabel';
            console.log(task['taskStatusLabel'].className);

            for (let i = 0; i < task.batchCount; i++) {
                task.reqBody['seed'] = task.seed + i * task.reqBody['num_outputs'];

                let success = await doMakeImage(task);
                task.batchesDone++;

                if (!task.isProcessing) {
                    break;
                }

                if (success) {
                    successCount++;
                }
            }

            task.isProcessing = false;
            task['stopTask'].innerHTML = '<i class="fa-solid fa-trash-can"></i> Remove';
            task['taskStatusLabel'].style.display = 'none';

            time = new Date().getTime() - time;
            time /= 1000;

            if (successCount === task.batchCount) {
                task.outputMsg.innerText = 'Processed ' + task.numOutputsTotal + ' images in ' + time + ' seconds';

                // setStatus('request', 'done', 'success')
            } else {
                if (task.outputMsg.innerText.toLowerCase().indexOf('error') === -1) {
                    task.outputMsg.innerText = 'Task ended after ' + time + ' seconds';
                }
            }

            if (randomSeedField.checked) {
                seedField.value = task.seed;
            }

            currentTask = null;
        }
        checkTasks();
    }, [taskQueue]);

    const doMakeImage = async (task) => {
        if (task.stopped) {
            return;
        }

        const reqBody = task.reqBody;
        const batchCount = task.batchCount;
        const outputContainer = task.outputContainer;

        const previewPrompt = task['previewPrompt'];
        const progressBar = task['progressBar'];

        let res = '';
        let seed = reqBody['seed'];
        let numOutputs = parseInt(reqBody['num_outputs']);

        let images = [];

        try {
            res = await fetch('/image', {
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

                            // outputMsg.innerHTML = `Batch ${task.batchesDone + 1} of ${batchCount}`;
                            // outputMsg.innerHTML += `. Generating image(s): ${percent}%`;

                            // outputMsg.innerHTML += `. Time remaining (approx): ${timeRemaining}`;
                            // outputMsg.style.display = 'block';

                            if (stepUpdate.output !== undefined) {
                                makeImageContainers(numOutputs);

                                for (idx in stepUpdate.output) {
                                    let imgItem = images[idx];
                                    let img = imgItem.firstChild;
                                    let tmpImageData = stepUpdate.output[idx];
                                    img.src = tmpImageData['path'] + '?t=' + new Date().getTime();
                                }
                            }
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
                progressBar.style.display = 'none';
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

        lastPromptUsed = reqBody['prompt'];

        makeImageContainers(res.output.length);

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

            let imgItem = images[idx];
            let img = imgItem.firstChild;

            img.src = imgBody;

            let imgItemInfo = document.createElement('span');
            imgItemInfo.className = 'imgItemInfo';
            imgItemInfo.style.opacity = 0;

            let imgSeedLabel = document.createElement('span');
            imgSeedLabel.className = 'imgSeedLabel';
            imgSeedLabel.innerText = 'Seed: ' + seed;

            let imgUseBtn = document.createElement('button');
            imgUseBtn.className = 'imgUseBtn';
            imgUseBtn.innerText = 'Use as Input';

            let imgSaveBtn = document.createElement('button');
            imgSaveBtn.className = 'imgSaveBtn';
            imgSaveBtn.innerText = 'Download';

            imgItem.appendChild(imgItemInfo);
            imgItemInfo.appendChild(imgSeedLabel);
            imgItemInfo.appendChild(imgUseBtn);
            imgItemInfo.appendChild(imgSaveBtn);

            imgUseBtn.addEventListener('click', function () {
                initImageSelector.value = null;
                initImagePreview.src = imgBody;

                initImagePreviewContainer.style.display = 'block';
                inpaintingEditorContainer.style.display = 'none';
                promptStrengthContainer.style.display = 'block';
                maskSetting.checked = false;

                // maskSetting.style.display = 'block'

                randomSeedField.checked = false;
                seedField.value = seed;
                seedField.disabled = false;
            });

            imgSaveBtn.addEventListener('click', function () {
                let imgDownload = document.createElement('a');
                imgDownload.download = createFileName();
                imgDownload.href = imgBody;
                imgDownload.click();
            });

            imgItem.addEventListener('mouseenter', function () {
                imgItemInfo.style.opacity = 1;
            });

            imgItem.addEventListener('mouseleave', function () {
                imgItemInfo.style.opacity = 0;
            });
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

        if (IMAGE_REGEX.test(initImagePreview.src)) {
            reqBody['init_image'] = initImagePreview.src;
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

        let taskConfig = `Seed: ${seed}, Sampler: ${reqBody['sampler']}, Inference Steps: ${numInferenceStepsField}, Guidance Scale: ${guidanceScaleField}`;

        if (negativePromptField.trim() !== '') {
            taskConfig += `, Negative Prompt: ${negativePromptField.trim()}`;
        }

        if (reqBody['init_image'] !== undefined) {
            taskConfig += `, Prompt Strength: ${promptStrengthField}`;
        }

        if (useFaceCorrectionField.checked) {
            taskConfig += `, Fix Faces: ${reqBody['use_face_correction']}`;
        }

        if (useUpscalingField.checked) {
            taskConfig += `, Upscale: ${reqBody['use_upscale']}`;
        }

        task['reqBody'] = reqBody;
        task['seed'] = seed;
        task['batchCount'] = batchCount;
        task['isProcessing'] = false;

        let taskEntry = document.createElement('div');
        taskEntry.className = 'imageTaskContainer';
        taskEntry.innerHTML = ` <div class="taskStatusLabel">Enqueued</div>
                          <button class="secondaryButton stopTask"><i class="fa-solid fa-trash-can"></i> Remove</button>
                          <div class="preview-prompt collapsible active"></div>
                          <div class="taskConfig">${taskConfig}</div>
                          <div class="collapsible-content" style="display: block">
                              <div class="outputMsg"></div>
                              <div class="progressBar"></div>
                              <div class="img-preview">
                          </div>`;

        // createCollapsibles(taskEntry);

        task['numOutputsTotal'] = numOutputsTotal;
        task['taskStatusLabel'] = taskEntry.querySelector('.taskStatusLabel');
        task['outputContainer'] = taskEntry.querySelector('.img-preview');
        task['outputMsg'] = taskEntry.querySelector('.outputMsg');
        task['previewPrompt'] = taskEntry.querySelector('.preview-prompt');
        task['progressBar'] = taskEntry.querySelector('.progressBar');
        task['stopTask'] = taskEntry.querySelector('.stopTask');

        task['stopTask'].addEventListener('click', async function () {
            if (task['isProcessing']) {
                task.isProcessing = false;
                try {
                    let res = await fetch('/image/stop');
                } catch (e) {
                    console.log(e);
                }
            } else {
                let idx = newTaskQueue.indexOf(task);
                if (idx >= 0) {
                    newTaskQueue.splice(idx, 1);
                }

                newTaskQueue.remove();
            }
        });

        imagePreview.insertBefore(taskEntry, previewTools.nextSibling);

        task['previewPrompt'].innerText = prompt;

        newTaskQueue.unshift(task);
        setTaskQueue(newTaskQueue);

        initialText.style.display = 'none';
    }
};
