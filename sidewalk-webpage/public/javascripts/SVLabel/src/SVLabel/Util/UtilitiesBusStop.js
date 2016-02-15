//function getBusStopPositionLabel() {
//    return {
//        'NextToCurb' : {
//            'id' : 'NextToCurb',
//            'label' : 'Next to curb'
//        },
//        'AwayFromCurb' : {
//            'id' : 'AwayFromCurb',
//            'label' : 'Away from curb'
//        },
//        'None' : {
//            'id' : 'None',
//            'label' : 'Not provided'
//        }
//    }
//}
//
//
//function getHeadingEstimate(SourceLat, SourceLng, TargetLat, TargetLng) {
//    // This function takes a pair of lat/lng coordinates.
//    //
//    if (typeof SourceLat !== 'number') {
//        SourceLat = parseFloat(SourceLat);
//    }
//    if (typeof SourceLng !== 'number') {
//        SourceLng = parseFloat(SourceLng);
//    }
//    if (typeof TargetLng !== 'number') {
//        TargetLng = parseFloat(TargetLng);
//    }
//    if (typeof TargetLat !== 'number') {
//        TargetLat = parseFloat(TargetLat);
//    }
//
//    var dLng = TargetLng - SourceLng;
//    var dLat = TargetLat - SourceLat;
//
//    if (dLat === 0 || dLng === 0) {
//        return 0;
//    }
//
//    var angle = toDegrees(Math.atan(dLng / dLat));
//    //var angle = toDegrees(Math.atan(dLat / dLng));
//
//    return 90 - angle;
//}
//
//
//function getLabelCursorImagePath() {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'cursorImagePath' : undefined
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
//        },
//        'StopSign_None' : {
//            'id' : 'StopSign_None',
//            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'cursorImagePath' : 'public/img/cursors/Cursor_BusStopShelter2.png'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'cursorImagePath' : 'public/img/cursors/Cursor_Bench2.png'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'cursorImagePath' : 'public/img/cursors/Cursor_TrashCan3.png'
//        },
//        'Landmark_MailboxAndNewsPaperBox' : {
//            'id' : 'Landmark_MailboxAndNewsPaperBox',
//            'cursorImagePath' : 'public/img/cursors/Cursor_Mailbox2.png'
//        },
//        'Landmark_OtherPole' : {
//            'id' : 'Landmark_OtherPole',
//            'cursorImagePath' : 'public/img/cursors/Cursor_OtherPole.png'
//        }
//    }
//}
//
//
////
//// Returns image paths corresponding to each label type.
////
//function getLabelIconImagePath(labelType) {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'iconImagePath' : undefined
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'iconImagePath' : 'public/img/icons/Icon_BusStop.png'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'iconImagePath' : 'public/img/icons/Icon_BusStopSign_SingleLeg.png'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'iconImagePath' : 'public/img/icons/Icon_BusStopSign_TwoLegged.png'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'iconImagePath' : 'public/img/icons/Icon_BusStopSign_Column.png'
//        },
//        'StopSign_None' : {
//            'id' : 'StopSign_None',
//            'iconImagePath' : 'public/img/icons/Icon_BusStop.png'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'iconImagePath' : 'public/img/icons/Icon_BusStopShelter.png'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'iconImagePath' : 'public/img/icons/Icon_Bench.png'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'iconImagePath' : 'public/img/icons/Icon_TrashCan2.png'
//        },
//        'Landmark_MailboxAndNewsPaperBox' : {
//            'id' : 'Landmark_MailboxAndNewsPaperBox',
//            'iconImagePath' : 'public/img/icons/Icon_Mailbox2.png'
//        },
//        'Landmark_OtherPole' : {
//            'id' : 'Landmark_OtherPole',
//            'iconImagePath' : 'public/img/icons/Icon_OtherPoles.png'
//        }
//    }
//}
//
//
////
//// This function is used in OverlayMessageBox.js.
////
//function getLabelInstructions () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'instructionalText' : 'Explore mode: Find the closest bus stop and label surrounding landmarks',
//            'textColor' : 'rgba(255,255,255,1)'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">stop sign</span>',
//            'textColor' : 'rgba(255,255,255,1)'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
//            'textColor' : 'rgba(255,255,255,1)'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'instructionalText' :'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
//            'textColor' :'rgba(255,255,255,1)'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
//            'textColor' : 'rgba(255,255,255,1)'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus shelter</span>',
//            'textColor' : 'rgba(255,255,255,1)'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bench</span> nearby a bus stop',
//            'textColor' : 'rgba(255,255,255,1)'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">trash can</span> nearby a bus stop',
//            'textColor' : 'rgba(255,255,255,1)'
//        },
//        'Landmark_MailboxAndNewsPaperBox' : {
//            'id' : 'Landmark_MailboxAndNewsPaperBox',
//            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">mailbox or news paper box</span> nearby a bus stop',
//            'textColor' : 'rgba(255,255,255,1)'
//        },
//        'Landmark_OtherPole' : {
//            'id' : 'Landmark_OtherPole',
//            'instructionalText' : 'Label mode: Locate and click at the bottom of poles such as <span class="underline bold">traffic sign, traffic light, and light pole</span> nearby a bus stop',
//            'textColor' : 'rgba(255,255,255,1)'
//        }
//    }
//}
//
//function getRibbonConnectionPositions () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'text' : 'Walk',
//            'labelRibbonConnection' : '25px'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'text' : 'Stop Sign',
//            'labelRibbonConnection' : '112px'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'text' : 'One-leg Stop Sign',
//            'labelRibbonConnection' : '112px'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'text' : 'Two-leg Stop Sign',
//            'labelRibbonConnection' : '112px'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'text' : 'Column Stop Sign',
//            'labelRibbonConnection' : '112px'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'text' : 'Bus Shelter',
//            'labelRibbonConnection' : '188px'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'text' : 'Bench',
//            'labelRibbonConnection' : '265px'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'text' : 'Trash Can',
//            'labelRibbonConnection' : '338px'
//        },
//        'Landmark_MailboxAndNewsPaperBox' : {
//            'id' : 'Landmark_MailboxAndNewsPaperBox',
//            'labelRibbonConnection' : '411px'
//        },
//        'Landmark_OtherPole' : {
//            'id' : 'Landmark_OtherPole',
//            'labelRibbonConnection' : '484px'
//        }
//    }
//}
//
//// Colors selected from
//// http://colorbrewer2.org/
//// - Number of data classes: 4
//// - The nature of data: Qualitative
//// - Color scheme 1: Paired - (166, 206, 227), (31, 120, 180), (178, 223, 138), (51, 160, 44)
//// - Color scheme 2: Set2 - (102, 194, 165), (252, 141, 98), (141, 160, 203), (231, 138, 195)
//// I'm currently using Set 2
//function getLabelDescriptions () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'text' : 'Walk'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'text' : 'Bus Stop Sign'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'text' : 'One-leg Stop Sign'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'text' : 'Two-leg Stop Sign'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'text' : 'Column Stop Sign'
//        },
//        'StopSign_None' : {
//            'id' : 'StopSign_None',
//            'text' : 'Not provided'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'text' : 'Bus Stop Shelter'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'text' : 'Bench'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'text' : 'Trash Can / Recycle Can'
//        },
//        'Landmark_MailboxAndNewsPaperBox' : {
//            'id' : 'Landmark_MailboxAndNewsPaperBox',
//            'text' : 'Mailbox / News Paper Box'
//        },
//        'Landmark_OtherPole' : {
//            'id' : 'Landmark_OtherPole',
//            'text' : 'Traffic Sign / Pole'
//        }
//    }
//}
//
//function getLabelColors () {
//    return colorScheme2();
//}
//
//function colorScheme1 () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'fillStyle' : 'rgba(102, 194, 165, 0.9)'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'fillStyle' : 'rgba(102, 194, 165, 0.9)'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'fillStyle' : 'rgba(102, 194, 165, 0.9)'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'fillStyle' : 'rgba(102, 194, 165, 0.9)'
//        },
//        'StopSign_None' : {
//            'id' : 'StopSign_None',
//            'fillStyle' : 'rgba(102, 194, 165, 0.9'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'fillStyle' : 'rgba(252, 141, 98, 0.9)'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'fillStyle' : 'rgba(141, 160, 203, 0.9)'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'fillStyle' : 'rgba(231, 138, 195, 0.9)'
//        }
//    }
//}
//
////
//// http://www.colourlovers.com/business/trends/branding/7880/Papeterie_Haute-Ville_Logo
//function colorScheme2 () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'fillStyle' : 'rgba(0, 161, 203, 0.9)'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'fillStyle' : 'rgba(0, 161, 203, 0.9)'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'fillStyle' : 'rgba(0, 161, 203, 0.9)'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'fillStyle' : 'rgba(0, 161, 203, 0.9)'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'fillStyle' : 'rgba(215, 0, 96, 0.9)'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            // 'fillStyle' : 'rgba(229, 64, 40, 0.9)' // Kind of hard to distinguish from pink
//            // 'fillStyle' : 'rgba(209, 209, 2, 0.9)' // Puke-y
//            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'fillStyle' : 'rgba(97, 174, 36, 0.9)'
//        },
//        'Landmark_MailboxAndNewsPaperBox' : {
//            'id' : 'Landmark_MailboxAndNewsPaperBox',
//            'fillStyle' : 'rgba(67, 113, 190, 0.9)'
//        },
//        'Landmark_OtherPole' : {
//            'id' : 'Landmark_OtherPole',
//            'fillStyle' : 'rgba(249, 79, 101, 0.9)'
//        }
//    }
//}
//
////
////http://www.colourlovers.com/fashion/trends/street-fashion/7896/Floral_Much
//function colorScheme3 () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'fillStyle' : 'rgba(97, 210, 214, 0.9)'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'fillStyle' : 'rgba(97, 210, 214, 0.9)'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'fillStyle' : 'rgba(97, 210, 214, 0.9)'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'fillStyle' : 'rgba(97, 210, 214, 0.9)'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'fillStyle' : 'rgba(237, 20, 111, 0.9)'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'fillStyle' : 'rgba(237, 222, 69, 0.9)'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'fillStyle' : 'rgba(155, 240, 233, 0.9)'
//        }
//    }
//}
//
////
//// http://www.colourlovers.com/business/trends/branding/7884/Small_Garden_Logo
//function colorScheme4 () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'fillStyle' : 'rgba(229, 59, 81, 0.9)'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'fillStyle' : 'rgba(60, 181, 181, 0.9)'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'fillStyle' : 'rgba(236, 108, 32, 0.9)'
//        }
//    }
//}
//
////
//// http://www.colourlovers.com/business/trends/branding/7874/ROBAROV_WEBDESIGN
//function colorScheme5 () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'fillStyle' : 'rgba(208, 221, 43, 0.9)'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'fillStyle' : 'rgba(208, 221, 43, 0.9)'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'fillStyle' : 'rgba(208, 221, 43, 0.9)'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'fillStyle' : 'rgba(208, 221, 43, 0.9)'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'fillStyle' : 'rgba(152, 199, 61, 0.9)'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'fillStyle' : 'rgba(0, 169, 224, 0.9)'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'fillStyle' : 'rgba(103, 205, 220, 0.9)'
//        }
//    }
//}
//
////
////http://www.colourlovers.com/print/trends/magazines/7834/Print_Design_Annual_2010
//function colorScheme6 () {
//    return {
//        'Walk' : {
//            'id' : 'Walk',
//            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
//        },
//        'StopSign' : {
//            'id' : 'StopSign',
//            'fillStyle' : 'rgba(210, 54, 125, 0.9)'
//        },
//        'StopSign_OneLeg' : {
//            'id' : 'StopSign_OneLeg',
//            'fillStyle' : 'rgba(210, 54, 125, 0.9)'
//        },
//        'StopSign_TwoLegs' : {
//            'id' : 'StopSign_TwoLegs',
//            'fillStyle' : 'rgba(210, 54, 125, 0.9)'
//        },
//        'StopSign_Column' : {
//            'id' : 'StopSign_Column',
//            'fillStyle' : 'rgba(210, 54, 125, 0.9)'
//        },
//        'Landmark_Shelter' : {
//            'id' : 'Landmark_Shelter',
//            'fillStyle' : 'rgba(188, 160, 0, 0.9)'
//        },
//        'Landmark_Bench' : {
//            'id' : 'Landmark_Bench',
//            'fillStyle' : 'rgba(207, 49, 4, 0.9)'
//        },
//        'Landmark_TrashCan' : {
//            'id' : 'Landmark_TrashCan',
//            'fillStyle' : 'rgba(1, 142, 74, 0.9)'
//        }
//    }
//}
