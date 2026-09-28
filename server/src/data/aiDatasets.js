/**
 * Approved public datasets the JNN Study Assistant may recommend.
 *
 * This is a reviewed catalog, not a crawler: only these entries can ever be
 * cited as "Dataset" sources, and the assistant only sees the description
 * below — nothing is downloaded. Add/remove entries here (and restart) to
 * change what is approved. Keywords are matched against the question.
 */
export const APPROVED_DATASETS = [
  {
    name: 'Iris Dataset (UCI Machine Learning Repository)',
    publisher: 'UC Irvine',
    url: 'https://archive.ics.uci.edu/dataset/53/iris',
    description: '150 iris flower samples, 4 numeric features (sepal/petal length and width), 3 classes. A classic beginner dataset for classification and clustering.',
    keywords: ['iris', 'classification', 'clustering', 'machine learning', 'k-means', 'knn'],
  },
  {
    name: 'NSL-KDD Intrusion Detection Dataset',
    publisher: 'Canadian Institute for Cybersecurity, UNB',
    url: 'https://www.unb.ca/cic/datasets/nsl.html',
    description: 'Improved version of KDD Cup 99 network-connection records labelled normal or attack (DoS, probe, R2L, U2R); widely used to teach intrusion detection.',
    keywords: ['intrusion', 'ids', 'nsl-kdd', 'kdd', 'network attack', 'anomaly detection'],
  },
  {
    name: 'CIC-IDS2017 Intrusion Detection Dataset',
    publisher: 'Canadian Institute for Cybersecurity, UNB',
    url: 'https://www.unb.ca/cic/datasets/ids-2017.html',
    description: 'Labelled benign and attack network flows (brute force, DoS/DDoS, web attacks, botnet, port scan) captured over five days, with extracted flow features.',
    keywords: ['intrusion', 'ids', 'ddos', 'botnet', 'port scan', 'network traffic'],
  },
  {
    name: 'MNIST Handwritten Digits (Hugging Face)',
    publisher: 'Hugging Face Datasets',
    url: 'https://huggingface.co/datasets/ylecun/mnist',
    description: '70,000 28x28 grayscale images of handwritten digits 0-9 (60k train / 10k test); the standard first dataset for neural networks and image classification.',
    keywords: ['mnist', 'digits', 'neural network', 'cnn', 'image classification', 'deep learning', 'handwritten'],
  },
  {
    name: 'Titanic Passenger Data (OpenML)',
    publisher: 'OpenML',
    url: 'https://www.openml.org/d/40945',
    description: 'Passenger records (class, sex, age, fare, etc.) with survival labels; common for teaching data cleaning, EDA and binary classification.',
    keywords: ['titanic', 'eda', 'data cleaning', 'pandas', 'logistic regression', 'binary classification'],
  },
];
