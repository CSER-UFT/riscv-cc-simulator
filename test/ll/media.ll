; ModuleID = 'media.c'
source_filename = "media.c"
target datalayout = "e-m:e-p:32:32-i64:64-n32-S128"
target triple = "riscv32-unknown-unknown"

@notas = dso_local global [6 x float] [float 7.000000e+00, float 8.500000e+00, float 6.000000e+00, float 9.500000e+00, float 5.000000e+00, float 9.000000e+00], align 4

; Function Attrs: noinline nounwind optnone
define dso_local float @media(ptr noundef %0, i32 noundef %1) #0 {
  %3 = alloca ptr, align 4
  %4 = alloca i32, align 4
  %5 = alloca float, align 4
  %6 = alloca i32, align 4
  store ptr %0, ptr %3, align 4
  store i32 %1, ptr %4, align 4
  store float 0.000000e+00, ptr %5, align 4
  store i32 0, ptr %6, align 4
  br label %7

7:                                                ; preds = %18, %2
  %8 = load i32, ptr %6, align 4
  %9 = load i32, ptr %4, align 4
  %10 = icmp slt i32 %8, %9
  br i1 %10, label %11, label %21

11:                                               ; preds = %7
  %12 = load ptr, ptr %3, align 4
  %13 = load i32, ptr %6, align 4
  %14 = getelementptr inbounds float, ptr %12, i32 %13
  %15 = load float, ptr %14, align 4
  %16 = load float, ptr %5, align 4
  %17 = fadd float %16, %15
  store float %17, ptr %5, align 4
  br label %18

18:                                               ; preds = %11
  %19 = load i32, ptr %6, align 4
  %20 = add nsw i32 %19, 1
  store i32 %20, ptr %6, align 4
  br label %7, !llvm.loop !5

21:                                               ; preds = %7
  %22 = load float, ptr %5, align 4
  %23 = load i32, ptr %4, align 4
  %24 = sitofp i32 %23 to float
  %25 = fdiv float %22, %24
  ret float %25
}

; Function Attrs: noinline nounwind optnone
define dso_local float @maximo(ptr noundef %0, i32 noundef %1) #0 {
  %3 = alloca ptr, align 4
  %4 = alloca i32, align 4
  %5 = alloca float, align 4
  %6 = alloca i32, align 4
  store ptr %0, ptr %3, align 4
  store i32 %1, ptr %4, align 4
  %7 = load ptr, ptr %3, align 4
  %8 = getelementptr inbounds float, ptr %7, i32 0
  %9 = load float, ptr %8, align 4
  store float %9, ptr %5, align 4
  store i32 1, ptr %6, align 4
  br label %10

10:                                               ; preds = %27, %2
  %11 = load i32, ptr %6, align 4
  %12 = load i32, ptr %4, align 4
  %13 = icmp slt i32 %11, %12
  br i1 %13, label %14, label %30

14:                                               ; preds = %10
  %15 = load ptr, ptr %3, align 4
  %16 = load i32, ptr %6, align 4
  %17 = getelementptr inbounds float, ptr %15, i32 %16
  %18 = load float, ptr %17, align 4
  %19 = load float, ptr %5, align 4
  %20 = fcmp ogt float %18, %19
  br i1 %20, label %21, label %26

21:                                               ; preds = %14
  %22 = load ptr, ptr %3, align 4
  %23 = load i32, ptr %6, align 4
  %24 = getelementptr inbounds float, ptr %22, i32 %23
  %25 = load float, ptr %24, align 4
  store float %25, ptr %5, align 4
  br label %26

26:                                               ; preds = %21, %14
  br label %27

27:                                               ; preds = %26
  %28 = load i32, ptr %6, align 4
  %29 = add nsw i32 %28, 1
  store i32 %29, ptr %6, align 4
  br label %10, !llvm.loop !7

30:                                               ; preds = %10
  %31 = load float, ptr %5, align 4
  ret float %31
}

; Function Attrs: noinline nounwind optnone
define dso_local float @main() #0 {
  %1 = call float @media(ptr noundef @notas, i32 noundef 6)
  ret float %1
}

attributes #0 = { noinline nounwind optnone "frame-pointer"="all" "no-trapping-math"="true" "stack-protector-buffer-size"="8" "target-cpu"="generic-rv32" "target-features"="+32bit,+f,+m,+relax,+zicsr,-a,-c,-d,-e,-experimental-zacas,-experimental-zcmop,-experimental-zfbfmin,-experimental-zicfilp,-experimental-zicfiss,-experimental-zimop,-experimental-ztso,-experimental-zvfbfmin,-experimental-zvfbfwma,-h,-smaia,-smepmp,-ssaia,-svinval,-svnapot,-svpbmt,-v,-xcvalu,-xcvbi,-xcvbitmanip,-xcvelw,-xcvmac,-xcvmem,-xcvsimd,-xsfvcp,-xsfvfnrclipxfqf,-xsfvfwmaccqqq,-xsfvqmaccdod,-xsfvqmaccqoq,-xtheadba,-xtheadbb,-xtheadbs,-xtheadcmo,-xtheadcondmov,-xtheadfmemidx,-xtheadmac,-xtheadmemidx,-xtheadmempair,-xtheadsync,-xtheadvdot,-xventanacondops,-za128rs,-za64rs,-zawrs,-zba,-zbb,-zbc,-zbkb,-zbkc,-zbkx,-zbs,-zca,-zcb,-zcd,-zce,-zcf,-zcmp,-zcmt,-zdinx,-zfa,-zfh,-zfhmin,-zfinx,-zhinx,-zhinxmin,-zic64b,-zicbom,-zicbop,-zicboz,-ziccamoa,-ziccif,-zicclsm,-ziccrse,-zicntr,-zicond,-zifencei,-zihintntl,-zihintpause,-zihpm,-zk,-zkn,-zknd,-zkne,-zknh,-zkr,-zks,-zksed,-zksh,-zkt,-zmmul,-zvbb,-zvbc,-zve32f,-zve32x,-zve64d,-zve64f,-zve64x,-zvfh,-zvfhmin,-zvkb,-zvkg,-zvkn,-zvknc,-zvkned,-zvkng,-zvknha,-zvknhb,-zvks,-zvksc,-zvksed,-zvksg,-zvksh,-zvkt,-zvl1024b,-zvl128b,-zvl16384b,-zvl2048b,-zvl256b,-zvl32768b,-zvl32b,-zvl4096b,-zvl512b,-zvl64b,-zvl65536b,-zvl8192b" }

!llvm.module.flags = !{!0, !1, !2, !3}
!llvm.ident = !{!4}

!0 = !{i32 1, !"wchar_size", i32 4}
!1 = !{i32 1, !"target-abi", !"ilp32f"}
!2 = !{i32 7, !"frame-pointer", i32 2}
!3 = !{i32 8, !"SmallDataLimit", i32 8}
!4 = !{!"Ubuntu clang version 18.1.3 (1ubuntu1)"}
!5 = distinct !{!5, !6}
!6 = !{!"llvm.loop.mustprogress"}
!7 = distinct !{!7, !6}
