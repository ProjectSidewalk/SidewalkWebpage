# modified from
# https://github.com/pytorch/vision/blob/master/torchvision/datasets/folder.py
# to support folders with two files per sample
# Galen Weld, Feb 2019

import torch.utils.data as data
from PIL import Image

import os
import os.path
import sys
import math

import numpy as np
import json
import torch
import random


def make_dataset(dir, class_to_idx):
    '''  reteurns a list of (img_path, meta_path, class_index) tuples
    ''' 
    images = []
    dir = os.path.expanduser(dir)
    for target in sorted(class_to_idx.keys()):
        d = os.path.join(dir, target)
        if not os.path.isdir(d):
            continue

        for root, _, fnames in sorted(os.walk(d)):
            sample_roots = set() # not including extensions here
            for fname in sorted(fnames):
                basename, ext  = os.path.splitext(fname)
                if ext in ('.jpg', '.json'):
                    sample_roots.add(basename)
            for basename in sample_roots:
                    img_path  = os.path.join(root, basename + '.jpg')
                    meta_path = os.path.join(root, basename + '.json')
                    item = (img_path, meta_path, class_to_idx[target])
                    if os.path.exists(img_path) and os.path.exists(meta_path):
                        images.append(item)
                    if not os.path.exists(img_path):
                        print( "Couldn't find img {}".format(img_path) )
                    if not os.path.exists(meta_path):
                        print( "Couldn't find meta {}".format(meta_path) )

    return images

def pil_loader(path):
    # open path as file to avoid ResourceWarning (https://github.com/python-pillow/Pillow/issues/835)
    with open(path, 'rb') as f:
        img = Image.open(f)
        return img.convert('RGB')


def accimage_loader(path):
    import accimage
    try:
        return accimage.Image(path)
    except IOError:
        # Potentially a decoding problem, fall back to PIL.Image
        return pil_loader(path)


def default_loader(path):
    from torchvision import get_image_backend
    if get_image_backend() == 'accimage':
        return accimage_loader(path)
    else:
        return pil_loader(path)

def meta_to_tensor1(meta_dict):
    features = []

    # crop size as proxy for depth
    # hacky approximate normilization
    features.append( meta_dict[u'crop size']/1000 )
    
    # pano yaw degree
    features.append( np.sin(np.deg2rad(meta_dict[u'pano yaw'])) )
    features.append( np.cos(np.deg2rad(meta_dict[u'pano yaw'])) )
    
    # sv_x converted to degree
    horiz_degree = (meta_dict[u'sv_x'] / 13312) * 360
    features.append( np.sin(np.deg2rad( horiz_degree )) )
    features.append( np.cos(np.deg2rad( horiz_degree )) )
    
    # sv_y converted to degree
    vert_degree = (meta_dict[u'sv_y'] / 3328) * 360
    features.append( np.sin(np.deg2rad( vert_degree )) )
    features.append( np.cos(np.deg2rad( vert_degree )) )

    return features

def meta_to_tensor2(meta_dict):
    features = []

    # crop size as proxy for depth
    # hacky approximate normilization
    features.append( meta_dict[u'crop size']/1000 )
    
    # pano yaw degree
    features.append( np.sin(np.deg2rad(float(meta_dict[u'pano yaw']))) )
    features.append( np.cos(np.deg2rad(float(meta_dict[u'pano yaw']))) )
    
    # sv_x converted to degree
    horiz_degree = (float(meta_dict[u'sv_x']) / 13312) * 360
    features.append( np.sin(np.deg2rad( horiz_degree )) )
    features.append( np.cos(np.deg2rad( horiz_degree )) )
    
    # sv_y converted to degree
    vert_degree = (float(meta_dict[u'sv_y']) / 3328) * 360
    features.append( np.sin(np.deg2rad( vert_degree )) )
    features.append( np.cos(np.deg2rad( vert_degree )) )

    # dist to cbd
    # more hacky normalization
    try:
        dist_to_cbd = float(meta_dict[u'dist to cbd'])
    except KeyError as e:
        dist_to_cbd = 0.0
    if math.isnan(dist_to_cbd):
        dist_to_cbd = 0.0
    features.append( dist_to_cbd/10) 

    # bearing to cbd broken into sin and cos
    try:
        bearing_to_cbd = float(meta_dict[u'bearing to cbd'])
    except KeyError as e:
        bearing_to_cbd = 0.0
    if math.isnan(bearing_to_cbd):
        bearing_to_cbd = 0.0
    features.append( np.sin(np.deg2rad( bearing_to_cbd )) )
    features.append( np.cos(np.deg2rad( bearing_to_cbd )) )

    # distance to intersection (feet)
    # more hacky normalization
    try:
        dist_to_int = float(meta_dict[u'dist to intersection'])
    except KeyError as e:
        dist_to_int = 0.0
    if math.isnan(dist_to_int):
        dist_to_int = 0.0
    features.append( dist_to_int/100 )

    # block middleness normalized to [0,.5]
    try:
        block_middleness = float(meta_dict[u'block middleness'])
    except KeyError as e:
        block_middleness = 0.0
    if math.isnan(block_middleness):
        block_middleness = 0.0
    features.append(block_middleness/100)

    return features


def meta_to_tensor(path_to_meta, version):
    ''' used by getitem to load the meta into a tensor'''
    with open(path_to_meta) as metafile:
        features_maker = {1: meta_to_tensor1, 2: meta_to_tensor2}

        meta_dict = json.load(metafile)
        
        features = features_maker[version](meta_dict)
        
        return torch.Tensor( features )


class TwoFileFolder(data.Dataset):
    """A custom data loader for project sidewalk data where the samples are arranged in this way:
        root/class_x/xxx.jpg
        root/class_x/xxx.json
        root/class_x/xxy.jpg
        root/class_x/xxy.json
        root/class_y/123.ext
    Where each sample has two associated files, an image, and a .json metadata file

    Args:
        root (string): Root directory path.
        loader (callable): A function to load a sample given its path.
        extensions (list[string]): A list of allowed extensions.
        transform (callable, optional): A function/transform that takes in
            a sample and returns a transformed version.
            E.g, ``transforms.RandomCrop`` for images.
        target_transform (callable, optional): A function/transform that takes
            in the target and transforms it.
        downsample: randomly downsample the the dataset to the provided size
        second_root is used to make a singele dataset from two roots. classes must match
        identically
     Attributes:
        classes (list): List of the class names.
        class_to_idx (dict): Dict with items (class_name, class_index).
        samples (list): List of (img_path, meta_path, class_index) tuples
        targets (list): The class_index value for each image in the dataset
    """

    def __init__(self, root, meta_to_tensor_version, transform=None, target_transform=None, downsample=None, second_root=None):
        classes, class_to_idx = self._find_classes(root)
        samples = make_dataset(root, class_to_idx)

        if second_root is not None:
            print('Computing second dataset directory {}'.format(second_root))
            snd_clss, snd_2_idx = self._find_classes(second_root)
            assert snd_clss == classes

            snd_samples = make_dataset(second_root, class_to_idx)

            print('Found {} additional images.'.format(len(snd_samples)))

            samples += snd_samples



        if len(samples) == 0:
            raise(RuntimeError("Found 0 files in subfolders of: " + root + "\n"
                               "Supported extensions are: " + ",".join( ('.jpg', '.json') )))

        if downsample is not None and len(samples) > downsample:
            samples = random.sample(samples, downsample)

        self.root = root
        self.loader = default_loader
        self.extensions = ('.jpg', '.json')

        self.classes = classes
        self.class_to_idx = class_to_idx
        self.samples = samples # list of tuples, (img_path, meta_path, target_idx)
        self.targets = [s[2] for s in samples]

        self.transform = transform
        self.target_transform = target_transform

        self.meta_to_tensor_version = meta_to_tensor_version

        # automatically compute the number of extra feats
        _, example_meta_path, _ = samples[0]
        self.len_ex_feats = len(meta_to_tensor(example_meta_path, version=self.meta_to_tensor_version))

    def _find_classes(self, dir):
        """
        Finds the class folders in a dataset.
        Args:
            dir (string): Root directory path.
        Returns:
            tuple: (classes, class_to_idx) where classes are relative to (dir), and class_to_idx is a dictionary.
        Ensures:
            No class is a subdirectory of another.
        """
        if sys.version_info >= (3, 5):
            # Faster and available in Python 3.5 and above
            classes = [d.name for d in os.scandir(dir) if d.is_dir()]
        else:
            classes = [d for d in os.listdir(dir) if os.path.isdir(os.path.join(dir, d))]
        classes.sort()
        classes = tuple(classes)
        class_to_idx = {classes[i]: i for i in range(len(classes))}
        return classes, class_to_idx

    def load_img_and_meta(self, img_path, meta_path):
        ''' expose this so we can call it from sliding_window '''
        img = self.loader(img_path)
        if self.transform is not None:
            img = self.transform(img)

        meta = meta_to_tensor(meta_path, version=self.meta_to_tensor_version)
        both = torch.cat((img.view(150528), meta))

        return both

    def __getitem__(self, index):
        """
        Args:
            index (int): Index
        Returns:
            tuple: (sample, target) where target is class_index of the target class.
        """
        img_path, meta_path, target = self.samples[index]

        both = self.load_img_and_meta(img_path, meta_path)

        if self.target_transform is not None:
            target = self.target_transform(target)

        return both, target, img_path

    def __len__(self):
        return len(self.samples)

    def __repr__(self):
        fmt_str = 'Dataset ' + self.__class__.__name__ + '\n'
        fmt_str += '    Number of datapoints: {}\n'.format(self.__len__())
        fmt_str += '    Root Location: {}\n'.format(self.root)
        tmp = '    Transforms (if any): '
        fmt_str += '{0}{1}\n'.format(tmp, self.transform.__repr__().replace('\n', '\n' + ' ' * len(tmp)))
        tmp = '    Target Transforms (if any): '
        fmt_str += '{0}{1}'.format(tmp, self.target_transform.__repr__().replace('\n', '\n' + ' ' * len(tmp)))
        return fmt_str

