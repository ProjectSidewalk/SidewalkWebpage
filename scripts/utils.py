#Code created and modified by Kotaro, Galen Weld, Kavi Devi, and Devesh Sarda 
import math
import os
import json
def bilinear_interpolation(x, y, points):
	'''Interpolate (x,y) from values associated with four points.

	The four points are a list of four triplets:  (x, y, value).
	The four points can be in any order.  They should form a rectangle.

		>>> bilinear_interpolation(12, 5.5,
		...                        [(10, 4, 100),
		...                         (20, 4, 200),
		...                         (10, 6, 150),
		...                         (20, 6, 300)])
		165.0
	
	Code written by Raymond Hettinger. Check:
	http://stackoverflow.com/questions/8661537/how-to-perform-bilinear-interpolation-in-python
	'''
	# See formula at:  http://en.wikipedia.org/wiki/Bilinear_interpolation

	points = sorted(points)               # order points by x, then by y
	(x1, y1, q11), (_x1, y2, q12), (x2, _y1, q21), (_x2, _y2, q22) = points


	if (x1 == _x1) and (x1 == x2) and (x1 == _x2):
		if x != x1:
			raise ValueError('(x, y) not on the x-axis')
		if y == y1:
			return q11
		return (q11 * (_y2 - y) + q22 * (y - y1)) / ((_y2 - y1) + 0.0)
	if (y1 == _y1) and (y1 == y2) and (y1 == _y2):
		if y != y1 :
			raise ValueError('(x, y) not on the y-axis')
		if x == x1:
			return q11
		return (q11 * (_x2 - x) + q22 * (x - x1)) / ((_x2 - x1) + 0.0)
			

	if x1 != _x1 or x2 != _x2 or y1 != _y1 or y2 != _y2:
		raise ValueError('points do not form a rectangle')
	if not x1 <= x <= x2 or not y1 <= y <= y2:
		#print( "x, y, x1, x2, y1, y2", x, y, x1, x2, y1, y2  )
		raise ValueError('(x, y) not within the rectangle')

	return (q11 * (x2 - x) * (y2 - y) +
			q21 * (x - x1) * (y2 - y) +
			q12 * (x2 - x) * (y - y1) +
			q22 * (x - x1) * (y - y1)) / ((x2 - x1) * (y2 - y1) + 0.0)


def interpolated_3d_point(xi, yi, x_3d, y_3d, z_3d, scale=26):
	"""
	 This function takes a GSV image point (xi, yi) and 3d point cloud data (x_3d, y_3d, z_3d) and 
	 returns its estimated 3d point. 
	"""
	xi = float(xi) / scale
	yi = float(yi) / scale
	xi1 = int(math.floor(xi))
	xi2 = int(math.ceil(xi))
	yi1 = int(math.floor(yi))
	yi2 = int(math.ceil(yi))
	
	if xi1 == xi2 and yi1 == yi2:
		val_x = x_3d[yi1, xi1]
		val_y = y_3d[yi1, xi1]
		val_z = z_3d[yi1, xi1]
	else:
		points_x = ((xi1, yi1, x_3d[yi1, xi1]),   (xi1, yi2, x_3d[yi2, xi1]), (xi2, yi1, x_3d[yi1, xi2]), (xi2, yi2, x_3d[yi2, xi2]))         
		points_y = ((xi1, yi1, y_3d[yi1, xi1]),   (xi1, yi2, y_3d[yi2, xi1]), (xi2, yi1, y_3d[yi1, xi2]), (xi2, yi2, y_3d[yi2, xi2]))
		points_z = ((xi1, yi1, z_3d[yi1, xi1]),   (xi1, yi2, z_3d[yi2, xi1]), (xi2, yi1, z_3d[yi1, xi2]), (xi2, yi2, z_3d[yi2, xi2]))                  
		val_x = bilinear_interpolation(xi, yi, points_x)
		val_y = bilinear_interpolation(xi, yi, points_y)
		val_z = bilinear_interpolation(xi, yi, points_z)

	return (val_x, val_y, val_z)

def predict_crop_size_by_position(x, y, im_width, im_height):
	dist_to_center = math.sqrt((x - im_width / 2) ** 2 + (y - im_height / 2) ** 2)
	# Calculate distance from point to center of left edge
	dist_to_left_edge = math.sqrt((x - 0) ** 2 + (y - im_height / 2) ** 2)
	# Calculate distance from point to center of right edge
	dist_to_right_edge = math.sqrt((x - im_width) ** 2 + (y - im_height / 2) ** 2)

	min_dist = min([dist_to_center, dist_to_left_edge, dist_to_right_edge])

	crop_size = (4.0 / 15.0) * min_dist + 200

	return crop_size


def predict_crop_size(x, y, im_width, im_height, depth_txt):
	"""
	# Calculate distance from point to image center
	dist_to_center = math.sqrt((x-im_width/2)**2 + (y-im_height/2)**2)
	# Calculate distance from point to center of left edge
	dist_to_left_edge = math.sqrt((x-0)**2 + (y-im_height/2)**2)
	# Calculate distance from point to center of right edge
	dist_to_right_edge = math.sqrt((x - im_width) ** 2 + (y - im_height/2) ** 2)

	min_dist = min([dist_to_center, dist_to_left_edge, dist_to_right_edge])

	crop_size = (4.0/15.0)*min_dist + 200

	print("Min dist was "+str(min_dist))
	"""
	### TEMP FIX FOR THE DEPTH CALCULATION. See Github Issue: https://github.com/ProjectSidewalk/sidewalk-cv-tools/issues/2 ###
	x *= 13312/im_width
	x *= 13312/im_width
	y *= 6656/im_width
	crop_size = 0
	try:
		depth_x = depth_txt[:, 0::3]
		depth_y = depth_txt[:, 1::3]
		depth_z = depth_txt[:, 2::3]
		depth = interpolated_3d_point(x, y, depth_x, depth_y, depth_z)
		depth_x = depth[0]
		depth_y = depth[1]
		depth_z = depth[2]
		distance = math.sqrt(depth_x ** 2 + depth_y ** 2 + depth_z ** 2)
		if distance == "nan":
			dist_to_center = math.sqrt((x - im_width / 2) ** 2 + (y - im_height / 2) ** 2)
			dist_to_left_edge = math.sqrt((x - 0) ** 2 + (y - im_height / 2) ** 2)
			dist_to_right_edge = math.sqrt((x - im_width) ** 2 + (y - im_height / 2) ** 2)

			min_dist = min([dist_to_center, dist_to_left_edge, dist_to_right_edge])

			crop_size = (4.0 / 15.0) * min_dist + 200

		else:
			crop_size = 2050 - 110 * distance
			crop_size = 8725.6 * (distance ** -1.192)
			if crop_size < 50:
				crop_size = 50
			elif crop_size > 1500:
				crop_size = 1500

	except IOError:
		dist_to_center = math.sqrt((x - im_width / 2) ** 2 + (y - im_height / 2) ** 2)
		dist_to_left_edge = math.sqrt((x - 0) ** 2 + (y - im_height / 2) ** 2)
		dist_to_right_edge = math.sqrt((x - im_width) ** 2 + (y - im_height / 2) ** 2)

		min_dist = min([dist_to_center, dist_to_left_edge, dist_to_right_edge])

		crop_size = (4.0 / 15.0) * min_dist + 200

	return crop_size


def make_single_crop(im, GSV_IMAGE_WIDTH, GSV_IMAGE_HEIGHT, depth_txt, pano_id, sv_image_x, sv_image_y, PanoYawDeg, output_filebase, factor = 1):
	img_filename  = output_filebase + '.jpg'
	meta_filename = output_filebase + '.json'
	im_width = GSV_IMAGE_WIDTH
	im_height = GSV_IMAGE_HEIGHT
	x = ((float(PanoYawDeg) / 360) * im_width + sv_image_x) % im_width
	y = im_height / 2 - sv_image_y

	# Crop rectangle around label
	cropped_square = None
	
	predicted_crop_size = -1
	try:
		predicted_crop_size = factor * predict_crop_size(x, y, im_width, im_height, depth_txt)
		crop_width = predicted_crop_size
		crop_height = predicted_crop_size
		#print(x, y)
		top_left_x = x - crop_width / 2
		top_left_y = y - crop_height / 2
		cropped_square = im.crop((top_left_x, top_left_y, top_left_x + crop_width, top_left_y + crop_height))
	except (ValueError, IndexError) as e:
		predicted_crop_size = factor * predict_crop_size_by_position(x, y, im_width, im_height)
		crop_width = predicted_crop_size
		crop_height = predicted_crop_size
		#print(x, y)
		top_left_x = x - crop_width / 2
		top_left_y = y - crop_height / 2
		cropped_square = im.crop((top_left_x, top_left_y, top_left_x + crop_width, top_left_y + crop_height))
	predicted_crop_size *= factor
	if(predict_crop_size != -1):
		crop_width = predicted_crop_size
		crop_height = predicted_crop_size
		#print(x, y)
		top_left_x = max(x - crop_width / 2, 0)
		top_left_y = max(y - crop_height / 2, 0)
		bottom_right_x = min(top_left_x + crop_width,im_width)
		bottom_right_y = min(top_left_y + crop_height,im_height)
		cropped_square = im.crop((top_left_x, top_left_y,bottom_right_x, bottom_right_y))
		cropped_square.save(img_filename)

	# write metadata
	meta = {'crop size' : predicted_crop_size,
			'sv_x'      : sv_image_x,
			'sv_y'      : sv_image_y,
			'crop_x'    : x,
			'crop_y'    : y,
			'pano yaw'  : PanoYawDeg,
			'pano id'   : pano_id
		   }

	with open(meta_filename, 'w') as metafile:
		json.dump(meta, metafile)

	return

def clear_dir(dir_to_clear):
	''' deletes all files in a directory and it's sub directories '''
	for r,d,f in os.walk(dir_to_clear):
		for filename in f:
			os.remove(os.path.join(r, filename))


def get_model_name():
	'''Returns the name of the current model in the models folder and None if doesn't find any '''
	name = os.getcwd()
	for file in os.listdir("models"): 
		name, ext = file.split(".")
		if(ext == "pt"):
			return name
	return None