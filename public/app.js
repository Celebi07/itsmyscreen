const createView = document.getElementById('createView');
const pollView = document.getElementById('pollView');
const optionsContainer = document.getElementById('options');
const createForm = document.getElementById('createForm');
const createError = document.getElementById('createError');
const shareBox = document.getElementById('shareBox');
const shareLink = document.getElementById('shareLink');
const pollQuestion = document.getElementById('pollQuestion');
const voteForm = document.getElementById('voteForm');
const voteMessage = document.getElementById('voteMessage');
const totalVotes = document.getElementById('totalVotes');

let eventSource;

function addOptionField(value = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Option';
  input.className = 'option-input';
  input.required = true;
  input.value = value;
  optionsContainer.appendChild(input);
}

document.getElementById('addOption').addEventListener('click', () => addOptionField());
document.getElementById('copyLink').addEventListener('click', async () => {
  await navigator.clipboard.writeText(shareLink.value);
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  createError.textContent = '';

  const question = document.getElementById('question').value.trim();
  const options = [...document.querySelectorAll('.option-input')]
    .map((input) => input.value.trim())
    .filter(Boolean);

  const response = await fetch('/api/polls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, options }),
  });

  const data = await response.json();
  if (!response.ok) {
    createError.textContent = data.error || 'Could not create poll';
    return;
  }

  shareBox.classList.remove('hidden');
  shareLink.value = data.shareLink;
  history.pushState({}, '', `/poll/${data.pollId}`);
  loadPoll(data.pollId);
});

async function loadPoll(pollId) {
  const response = await fetch(`/api/polls/${pollId}`);
  const poll = await response.json();

  if (!response.ok) {
    createView.classList.remove('hidden');
    pollView.classList.add('hidden');
    createError.textContent = poll.error || 'Poll not found';
    return;
  }

  createView.classList.add('hidden');
  pollView.classList.remove('hidden');
  renderPoll(poll);

  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/polls/${pollId}/events`);
  eventSource.onmessage = (evt) => {
    const nextPoll = JSON.parse(evt.data);
    renderPoll(nextPoll);
  };
}

function renderPoll(poll) {
  pollQuestion.textContent = poll.question;
  totalVotes.textContent = `Total votes: ${poll.totalVotes}`;

  voteForm.innerHTML = '';
  poll.options.forEach((option) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'option-result';

    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="voteOption" value="${option.id}" /> ${option.label} (${option.votes})`;

    const percentage = poll.totalVotes ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
    const progress = document.createElement('div');
    progress.className = 'progress';
    progress.innerHTML = `<span style="width:${percentage}%"></span>`;

    wrapper.appendChild(label);
    wrapper.appendChild(progress);
    voteForm.appendChild(wrapper);
  });

  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Submit vote';
  voteForm.appendChild(button);
}

voteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  voteMessage.textContent = '';

  const selected = voteForm.querySelector('input[name="voteOption"]:checked');
  if (!selected) {
    voteMessage.textContent = 'Please choose an option.';
    return;
  }

  const pollId = location.pathname.split('/')[2];
  const response = await fetch(`/api/polls/${pollId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: selected.value }),
  });

  const result = await response.json();
  if (!response.ok) {
    voteMessage.textContent = result.error || 'Vote failed';
    return;
  }

  voteMessage.textContent = 'Vote recorded!';
});

function init() {
  addOptionField();
  addOptionField();

  const pathParts = location.pathname.split('/').filter(Boolean);
  if (pathParts[0] === 'poll' && pathParts[1]) {
    loadPoll(pathParts[1]);
  }
}

init();
